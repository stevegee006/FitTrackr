import Foundation
import Capacitor
import ActivityKit

/**
 Capacitor bridge for the rest-timer Live Activity.

 Exposed to JavaScript as `Capacitor.Plugins.RestTimer` with `start`, `update`
 and `end`. The web side calls it through `lib/native.ts`, which detects the
 injected `window.Capacitor` global rather than importing `@capacitor/core` —
 so the same bundle runs unchanged in Safari and in the PWA, where these
 methods simply do not exist.

 Add this file to the APP target (not the widget).

 Everything is best-effort. A Live Activity is a nicety; failing to start one
 must never break the timer the athlete is actually looking at, so failures
 resolve rather than reject.
 */
@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin {

    /// The activity currently on screen, if any. `Any?` because the concrete
    /// `Activity<RestTimerAttributes>` type is only available on iOS 16.1+ and
    /// a stored property cannot carry an availability annotation.
    private static var current: Any?

    // MARK: - JS surface

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // Live Activities switched off in Settings. Not an error.
            return call.resolve(["started": false, "reason": "disabled"])
        }
        guard let state = Self.state(from: call) else {
            return call.resolve(["started": false, "reason": "invalid"])
        }

        // Reuse rather than stack. Completing the next set while rest is still
        // running should move the existing activity on, not leave two on the
        // Lock Screen — which is exactly why the exercise and set live in
        // ContentState instead of the static attributes.
        if let existing = Self.current as? Activity<RestTimerAttributes> {
            Task {
                await existing.update(using: state)
                call.resolve(["started": true, "reused": true])
            }
            return
        }

        let attributes = RestTimerAttributes(
            workoutName: call.getString("workoutName") ?? "Workout"
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                contentState: state,
                pushType: nil          // Self-counting: no APNs, no entitlement.
            )
            Self.current = activity
            call.resolve(["started": true, "reused": false])
        } catch {
            CAPLog.print("RestTimer: could not start Live Activity — \(error)")
            call.resolve(["started": false, "reason": "\(error)"])
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        guard
            let activity = Self.current as? Activity<RestTimerAttributes>,
            let state = Self.state(from: call)
        else { return call.resolve() }

        Task {
            await activity.update(using: state)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        guard let activity = Self.current as? Activity<RestTimerAttributes> else {
            return call.resolve()
        }
        Self.current = nil

        Task {
            // `.immediate` — a rest timer lingering after the set has started
            // is worse than no timer at all.
            await activity.end(dismissalPolicy: .immediate)
            call.resolve()
        }
    }

    // MARK: - Parsing

    /// JS sends epoch MILLISECONDS; Swift wants seconds.
    @available(iOS 16.1, *)
    private static func state(from call: CAPPluginCall) -> RestTimerAttributes.ContentState? {
        guard
            let endsAtMs = call.getDouble("endsAt"),
            let startedAtMs = call.getDouble("startedAt")
        else { return nil }

        return RestTimerAttributes.ContentState(
            exerciseName: call.getString("exerciseName") ?? "Exercise",
            setNumber: call.getInt("setNumber") ?? 1,
            totalSets: call.getInt("totalSets") ?? 1,
            endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000)
        )
    }
}
