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
        CAPPluginMethod(name: "rest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
    ]

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

    /// Pause or resume the wrist session alongside the phone's clock.
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
}
