import Foundation
import Capacitor
import ActivityKit

/**
 Capacitor bridge for the session Live Activity.

 Exposed to JavaScript as `Capacitor.Plugins.WorkoutActivity` with two methods:
 `sync` and `end`, registered via `CAPBridgedPlugin`. Deliberately only two — `sync` starts the activity if there
 is none and updates it otherwise, so the web side never has to track whether
 one exists. Every state change (clock started, paused, resumed, a set ticked,
 rest begun or finished) is the same call with a different payload, which makes
 it idempotent and impossible to get out of step.

 Add this file to the APP target (not the widget).

 Everything is best-effort. A Live Activity is a nicety; failing to start one
 must never break the timer the athlete is actually looking at, so failures
 resolve rather than reject.
 */
@objc(WorkoutActivityPlugin)
public class WorkoutActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    // Capacitor 7 registers plugins through this protocol. The old approach —
    // a CAP_PLUGIN macro in a companion .m file — no longer registers anything
    // on its own, and fails SILENTLY: the app builds, runs, and
    // `Capacitor.Plugins` simply does not contain the plugin. Check with
    // `Object.keys(Capacitor.Plugins)` in Safari's inspector rather than
    // guessing.
    //
    // `jsName` is the name JavaScript looks up; `identifier` is the ObjC class.
    public let identifier = "WorkoutActivityPlugin"
    public let jsName = "WorkoutActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// The activity currently on screen, if any. `Any?` because the concrete
    /// `Activity<WorkoutActivityAttributes>` type is only available on iOS
    /// 16.1+ and a stored property cannot carry an availability annotation.
    private static var current: Any?

    // MARK: - JS surface

    @objc func sync(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // Switched off in Settings. Not an error.
            return call.resolve(["active": false, "reason": "disabled"])
        }
        guard let state = Self.state(from: call) else {
            return call.resolve(["active": false, "reason": "invalid"])
        }

        // Alert scheduling rides along with the rest state, since this is the
        // one call that always carries it.
        Self.scheduleAlert(for: state, call: call)

        if let activity = Self.current as? Activity<WorkoutActivityAttributes> {
            Task {
                await activity.update(Self.content(for: state))
                call.resolve(["active": true, "created": false])
            }
            return
        }

        let attributes = WorkoutActivityAttributes(
            workoutName: call.getString("workoutName") ?? "Workout",
            workoutId: call.getString("workoutId") ?? ""
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: Self.content(for: state),
                pushType: nil          // Self-counting: no APNs, no entitlement.
            )
            Self.current = activity
            call.resolve(["active": true, "created": true])
        } catch {
            CAPLog.print("WorkoutActivity: could not start — \(error)")
            call.resolve(["active": false, "reason": "\(error)"])
        }
    }

    /**
     End every activity this app owns, not just the remembered one.

     `Self.current` is in-memory, so it is empty after a relaunch — and an
     activity started before the app was killed would then be unstoppable from
     here, left counting on the Lock Screen with no way to clear it but a
     swipe. `Activity.activities` is the live list from the system, which is
     the only source that survives the process.
     */
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        Self.current = nil
        RestAlerts.cancel()

        Task {
            // `.immediate` — an activity outliving its workout is worse than none.
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.end(dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    // MARK: - Content

    /**
     Wrap the state, with a stale date at the end of the rest.

     This is what makes the activity revert to the session clock on its own.
     The countdown runs in JavaScript, and iOS suspends the webview when the
     phone locks — which is precisely the moment rest is running and the phone
     is in a pocket. Nothing ever told the activity rest had finished, so it
     sat at 0:00 until the phone was unlocked.

     `staleDate` is the system's own answer to this: it re-renders the activity
     at that instant and sets `context.isStale`, and the views treat a stale
     rest as no rest. No push, no background execution, nothing of ours has to
     be running.

     Only set while resting. A stale date on the working phase would mark a
     perfectly current activity as out of date.
     */
    @available(iOS 16.1, *)
    private static func content(
        for state: WorkoutActivityAttributes.ContentState
    ) -> ActivityContent<WorkoutActivityAttributes.ContentState> {
        ActivityContent(state: state, staleDate: state.restEndsAt)
    }

    /**
     Alert when rest ends — unless the wrist is going to.

     An iPhone notification mirrors to a paired watch whenever the phone is
     locked, and the watch app buzzes from its own timer during a session. Both
     means two alerts for one rest, on the same wrist, moments apart.
     */
    @available(iOS 16.1, *)
    private static func scheduleAlert(
        for state: WorkoutActivityAttributes.ContentState,
        call: CAPPluginCall
    ) {
        guard let endsAt = state.restEndsAt else { return RestAlerts.cancel() }
        guard !PhoneWatchConnector.shared.watchSessionActive else { return RestAlerts.cancel() }
        RestAlerts.schedule(
            endsAt: endsAt,
            exerciseName: state.restExerciseName,
            setNumber: state.restSetNumber,
            totalSets: state.restTotalSets
        )
    }

    // MARK: - Parsing

    /// JS sends epoch MILLISECONDS; Swift wants seconds.
    @available(iOS 16.1, *)
    private static func state(from call: CAPPluginCall) -> WorkoutActivityAttributes.ContentState? {
        guard let startedAtMs = call.getDouble("startedAt") else { return nil }

        func date(_ key: String) -> Date? {
            guard let ms = call.getDouble(key) else { return nil }
            return Date(timeIntervalSince1970: ms / 1000)
        }

        return WorkoutActivityAttributes.ContentState(
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
            pausedAt: date("pausedAt"),
            setsDone: call.getInt("setsDone") ?? 0,
            setsTotal: call.getInt("setsTotal") ?? 0,
            restExerciseName: call.getString("restExerciseName"),
            restSetNumber: call.getInt("restSetNumber"),
            restTotalSets: call.getInt("restTotalSets"),
            restEndsAt: date("restEndsAt"),
            restStartedAt: date("restStartedAt")
        )
    }
}
