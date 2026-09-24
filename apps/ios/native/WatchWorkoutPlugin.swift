import Foundation
import Capacitor
import HealthKit

/**
 Capacitor bridge for the Apple Watch workout session.

 Exposed to JavaScript as `Capacitor.Plugins.WatchWorkout`. The web app calls
 `start` when the workout clock starts and `stop` when it is finished, so the
 watch records the session without anyone pressing anything on the wrist —
 which is the point.

 Everything resolves rather than rejects. A watch that is absent, asleep, or
 without the app installed must never stop the workout the athlete is logging
 on the phone.

 Registered in `MainViewController.capacitorDidLoad()` — Capacitor 6+ does not
 discover app-local plugins on its own. Add to the APP target.
 */
@objc(WatchWorkoutPlugin)
public class WatchWorkoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchWorkoutPlugin"
    public let jsName = "WatchWorkout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "summary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToHealth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "externalWorkouts", returnType: CAPPluginReturnPromise),
    ]

    /**
     Forward the watch's pause state to JavaScript as a `pauseChanged` event.

     Wired in `load()` rather than on first call, because the event can arrive
     before the web app has done anything — someone pauses on the wrist while
     the phone sits in a pocket — and a listener attached lazily would miss it.

     The web side owns the clock, so the wrist cannot pause it directly; it
     reports, and the page decides. That keeps one owner of the value that
     eventually becomes the workout's duration.
     */
    override public func load() {
        PhoneWatchConnector.shared.onPauseChanged = { [weak self] paused in
            self?.notifyListeners("pauseChanged", data: ["paused": paused])
        }
        // Skip / +10 / −10 from the wrist. Forwarded rather than acted on: the
        // rest timer's state lives in the web app, which is the only thing
        // that can move the finish line every surface reads.
        PhoneWatchConnector.shared.onRestCommand = { [weak self] command, delta in
            self?.notifyListeners("restCommand", data: ["command": command, "delta": delta])
        }
    }

    /// Lets the web app hide the feature rather than offer something that
    /// cannot work — no watch paired, or the app not installed on it.
    @objc func status(_ call: CAPPluginCall) {
        Task {
            // Reading through an unactivated session reports "no watch".
            await PhoneWatchConnector.shared.waitUntilActivated()
            call.resolve([
                "healthAvailable": HKHealthStore.isHealthDataAvailable(),
                "paired": PhoneWatchConnector.shared.isPaired,
                "appInstalled": PhoneWatchConnector.shared.isWatchAppInstalled,
            ])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let name = call.getString("workoutName") ?? "Workout"
        Task {
            do {
                try await PhoneWatchConnector.shared.startWorkout(named: name)
                call.resolve(["started": true])
            } catch {
                CAPLog.print("WatchWorkout: could not start — \(error)")
                call.resolve(["started": false, "reason": "\(error)"])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        PhoneWatchConnector.shared.stopWorkout()
        call.resolve(["stopped": true])
    }

    /**
     Workouts recorded elsewhere, for the web app to import.

     Returns them rather than posting them itself: the API call needs the
     session auth, which lives in the web layer, and duplicating token handling
     in Swift would be a second place for it to go wrong.
     */
    @objc func externalWorkouts(_ call: CAPPluginCall) {
        Task {
            // Authorisation first — the read types now include distance, and a
            // never-granted type returns nothing rather than failing.
            try? await PhoneWatchConnector.shared.requestAuthorization()
            let workouts = await PhoneWatchConnector.shared.externalWorkouts()
            call.resolve(["workouts": workouts])
        }
    }

    /// Pause or resume the wrist session alongside the phone clock.
    @objc func pause(_ call: CAPPluginCall) {
        PhoneWatchConnector.shared.sendPaused(call.getBool("paused") ?? false)
        call.resolve()
    }

    /**
     Mirror the rest countdown onto the wrist.

     Called with `endsAt` null when rest ends, so the web side sends state
     rather than events — the same shape as the Live Activity's `sync`, and for
     the same reason: a state push cannot get out of step with what the page is
     showing, whereas a missed "rest ended" event leaves a countdown running.
     */
    @objc func rest(_ call: CAPPluginCall) {
        let endsAtMs = call.getDouble("endsAt")
        PhoneWatchConnector.shared.sendRest(
            endsAt: endsAtMs.map { Date(timeIntervalSince1970: $0 / 1000) },
            exerciseName: call.getString("exerciseName"),
            setNumber: call.getInt("setNumber"),
            totalSets: call.getInt("totalSets")
        )
        call.resolve()
    }

    /**
     Average heart rate and active energy for the session that started at
     `startedAt` (epoch milliseconds).

     Resolves with `found: false` rather than rejecting when HealthKit has
     nothing yet — which is ordinary for the first seconds after finishing,
     since the watch saving the workout and it appearing in the phone's store
     are not the same moment. The web side retries on that.
     */
    @objc func summary(_ call: CAPPluginCall) {
        guard let startedAtMs = call.getDouble("startedAt") else {
            return call.resolve(["found": false, "reason": "no startedAt"])
        }
        let startedAt = Date(timeIntervalSince1970: startedAtMs / 1000)

        Task {
            guard let result = await PhoneWatchConnector.shared.workoutSummary(startedAt: startedAt) else {
                return call.resolve(["found": false])
            }
            var payload: [String: Any] = ["found": true]
            if let bpm = result.avgHeartRate { payload["avgHeartRateBpm"] = bpm }
            if let kcal = result.activeEnergyKcal { payload["activeEnergyKcal"] = kcal }
            call.resolve(payload)
        }
    }

    /**
     Write the finished session to Health from the phone, if the watch did not.

     Checks `workoutSummary` itself rather than trusting the caller: the web
     app knows whether it ASKED the watch to record, not whether the watch
     actually did — the wrist can be asleep, off, or flat, and `start` can time
     out (#145). Asking HealthKit what is actually stored is the only question
     with a reliable answer, and it makes a double-write impossible rather than
     merely unlikely.

     Resolves either way, like everything else here. Health is a nice-to-have;
     the workout is already saved on the server by the time this runs.
     */
    @objc func saveToHealth(_ call: CAPPluginCall) {
        guard let startedAtMs = call.getDouble("startedAt"),
              let endedAtMs = call.getDouble("endedAt") else {
            return call.resolve(["saved": false, "reason": "missing startedAt or endedAt"])
        }
        let startedAt = Date(timeIntervalSince1970: startedAtMs / 1000)
        let endedAt = Date(timeIntervalSince1970: endedAtMs / 1000)

        // A zero or negative span makes HKWorkoutBuilder throw, and the clock
        // has produced junk before — see handoff #72, where a restored anchor
        // of 0 wrote a workout of ~29.8 million minutes.
        guard endedAt > startedAt, endedAt.timeIntervalSince(startedAt) < 24 * 60 * 60 else {
            return call.resolve(["saved": false, "reason": "implausible duration"])
        }

        Task {
            /*
             WAIT before concluding the watch did not record.

             `finishWorkout()` on the wrist and the sample arriving in the
             phone's HealthKit store are not the same instant — `workoutSummary`
             says so in its own documentation, and the first version of this
             method ignored it. The watch wrote one, this checked immediately,
             found nothing, and wrote a second: one session, two entries in
             Fitness.

             Polled rather than delayed by a fixed sleep, so the common case
             still settles in about a second.
             */
            await PhoneWatchConnector.shared.waitUntilActivated()
            let watchCouldHaveRecorded = PhoneWatchConnector.shared.isPaired
                && PhoneWatchConnector.shared.isWatchAppInstalled

            if watchCouldHaveRecorded {
                for _ in 0..<20 {
                    if await PhoneWatchConnector.shared.workoutSummary(startedAt: startedAt) != nil {
                        // The watch's own record, with heart rate and energy
                        // this path cannot produce. Leave it alone.
                        return call.resolve(["saved": false, "reason": "watch already recorded"])
                    }
                    try? await Task.sleep(for: .seconds(1))
                }
            }
            // No watch, or it had 20 seconds and wrote nothing. A session the
            // watch never recorded is exactly the case this method exists for.
            do {
                try await PhoneWatchConnector.shared.requestAuthorization()
                try await PhoneWatchConnector.shared.saveWorkoutFromPhone(
                    startedAt: startedAt,
                    endedAt: endedAt
                )
                call.resolve(["saved": true])
            } catch {
                CAPLog.print("WatchWorkout: could not save to Health — \(error)")
                call.resolve(["saved": false, "reason": "\(error)"])
            }
        }
    }
}
