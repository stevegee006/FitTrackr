import Foundation
import ActivityKit

/**
 ONE Live Activity for the whole session, which changes phase rather than two
 activities competing.

 iOS shows a single Live Activity in the Dynamic Island at a time, so a
 session clock and a rest countdown as separate activities would fight over it
 and the athlete would get whichever started last. Instead this activity starts
 when the workout clock starts, ends when the workout is finished, and switches
 presentation while resting.

 IMPORTANT: this file must belong to BOTH targets — the app (which starts and
 updates it) and the widget extension (which renders it). If it is in only one,
 the other fails to compile with an unhelpful "cannot find type" error. In
 Xcode: select the file, then tick both under Target Membership.

 What is static and what is not:
   - `workoutName` and `workoutId` are fixed for the session → attributes.
   - Everything that moves — the clock anchor, pause state, set counts, and
     the rest countdown — is `ContentState`, so one activity carries the whole
     session. The attributes type is baked into a running activity and cannot
     be migrated, so this shape is worth getting right before the first build.
 */
struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Wall-clock anchor the elapsed time counts up from. Mirrors the web
        /// app's `startAnchorRef`, which is also an anchor rather than a
        /// counter — background tabs and locked phones throttle timers, so a
        /// decrementing counter drifts (the reason behind sharp edge #72).
        var startedAt: Date
        /// Non-nil when the clock is paused; the display freezes here.
        var pausedAt: Date?

        var setsDone: Int
        var setsTotal: Int

        // MARK: Rest phase — all nil while working.

        var restExerciseName: String?
        var restSetNumber: Int?
        var restTotalSets: Int?
        var restEndsAt: Date?
        var restStartedAt: Date?

        var isResting: Bool { restEndsAt != nil && restStartedAt != nil }

        /// The span the rest bar fills over.
        ///
        /// A zero-or-negative range crashes `ProgressView`, and the web side
        /// can legitimately produce one: pressing −10s repeatedly floors the
        /// end time at five seconds from *now*, which may be before the
        /// original start.
        var restInterval: ClosedRange<Date>? {
            guard let start = restStartedAt, let end = restEndsAt else { return nil }
            return start...max(end, start.addingTimeInterval(1))
        }

        /// Open-ended range for the count-UP elapsed timer. `Text` needs a
        /// range even when only the start matters, so the end is parked far
        /// enough out that it is never reached — a Live Activity is capped at
        /// 8 hours by the system long before this.
        var elapsedInterval: ClosedRange<Date> {
            startedAt...startedAt.addingTimeInterval(60 * 60 * 24)
        }
    }

    var workoutName: String
    var workoutId: String
}
