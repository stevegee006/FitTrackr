import Foundation
import ActivityKit

/**
 The shape of the rest-timer Live Activity.

 IMPORTANT: this file must belong to BOTH targets — the app (which starts and
 updates the activity) and the widget extension (which renders it). If it is
 only in one, the other fails to compile with an unhelpful "cannot find type"
 error. In Xcode: select the file, then tick both under Target Membership.

 Note what is static and what is not. `workoutName` never changes for the life
 of a session, so it is an attribute. The exercise and set DO change: finishing
 the next set while rest is still running updates the existing activity rather
 than starting a second one, so they live in `ContentState`. Getting this
 backwards is painful to fix later — the attributes type is baked into the
 activity, so a running activity cannot be migrated to a new shape.
 */
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// e.g. "Barbell Bench Press"
        var exerciseName: String
        /// 1-based, matching what the logger shows.
        var setNumber: Int
        var totalSets: Int
        /// When the countdown reaches zero.
        var endsAt: Date
        /// When this rest period began — the span the progress bar fills over.
        var startedAt: Date

        /// The range SwiftUI's self-counting timer views take.
        var interval: ClosedRange<Date> {
            // A zero-or-negative range crashes ProgressView, and the web side
            // can legitimately produce one: pressing −10s repeatedly floors the
            // end time at five seconds from *now*, which may be before the
            // original start.
            let safeEnd = max(endsAt, startedAt.addingTimeInterval(1))
            return startedAt...safeEnd
        }
    }

    /// e.g. "Push Day — Max Effort". Fixed for the whole session.
    var workoutName: String
}
