import Foundation
import Capacitor
import ActivityKit

/**
 Capacitor bridge for the session Live Activity.

 Exposed to JavaScript as `Capacitor.Plugins.WorkoutActivity` with two methods:
 `sync` and `end`. Deliberately only two — `sync` starts the activity if there
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
public class WorkoutActivityPlugin: CAPPlugin {

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

        if let activity = Self.current as? Activity<WorkoutActivityAttributes> {
            Task {
                await activity.update(using: state)
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
                contentState: state,
                pushType: nil          // Self-counting: no APNs, no entitlement.
            )
            Self.current = activity
            call.resolve(["active": true, "created": true])
        } catch {
            CAPLog.print("WorkoutActivity: could not start — \(error)")
            call.resolve(["active": false, "reason": "\(error)"])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        guard let activity = Self.current as? Activity<WorkoutActivityAttributes> else {
            return call.resolve()
        }
        Self.current = nil

        Task {
            // `.immediate` — an activity outliving its workout is worse than none.
            await activity.end(dismissalPolicy: .immediate)
            call.resolve()
        }
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
