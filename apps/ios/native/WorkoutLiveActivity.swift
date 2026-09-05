import SwiftUI
import WidgetKit
import ActivityKit

/**
 Lock Screen and Dynamic Island presentation for a training session.

 THE KEY TRICK: `Text(timerInterval:)` and `ProgressView(timerInterval:)` run
 **in the widget process, unaided**. The app hands over an anchor date once and
 never touches it again — no background execution, no APNs, no push
 entitlement, and therefore no paid Apple Developer account needed. That covers
 both directions:

   - elapsed time counts UP from the clock anchor (`countsDown: false`);
   - rest counts DOWN to its end date.

 So every update from the app is a real change — pausing, a new set, rest
 starting or finishing — never a tick.

 Pausing uses `pauseTime:`, which freezes the display at that instant without
 the app having to stream the frozen value.

 Add this file to the WIDGET EXTENSION target only.
 */

// The app's own accents.
private let accent = Color(red: 0.39, green: 0.40, blue: 0.95)   // indigo #6366f1
private let restTint = Color(red: 0.96, green: 0.62, blue: 0.04) // amber #f59e0b

struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenView(context: context)
                // Painted rather than translucent, to match the app's dark chrome.
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)

        } dynamicIsland: { context in
            let resting = context.state.isResting

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(resting ? (context.state.restExerciseName ?? "Rest")
                                     : context.attributes.workoutName)
                            .font(.caption).fontWeight(.semibold)
                            .lineLimit(1)
                        Text(subtitle(for: context.state))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PrimaryTimer(state: context.state, size: 22)
                        // Without a fixed width the digits jitter as they change.
                        .frame(width: 76, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let interval = context.state.restInterval {
                        ProgressView(timerInterval: interval, countsDown: true) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .tint(restTint)
                    } else {
                        SetsBar(state: context.state)
                    }
                }
            } compactLeading: {
                Image(systemName: resting ? "timer" : "figure.strengthtraining.traditional")
                    .foregroundStyle(resting ? restTint : accent)
            } compactTrailing: {
                PrimaryTimer(state: context.state, size: 13)
                    .frame(width: 48, alignment: .trailing)
            } minimal: {
                Image(systemName: resting ? "timer" : "figure.strengthtraining.traditional")
                    .foregroundStyle(resting ? restTint : accent)
            }
            .keylineTint(resting ? restTint : accent)
        }
    }

    private func subtitle(for state: WorkoutActivityAttributes.ContentState) -> String {
        if state.isResting, let n = state.restSetNumber, let total = state.restTotalSets {
            return "Set \(n) of \(total) done"
        }
        if state.pausedAt != nil { return "Paused" }
        return "\(state.setsDone) of \(state.setsTotal) sets"
    }
}

/// Rest countdown when resting, session elapsed otherwise.
private struct PrimaryTimer: View {
    let state: WorkoutActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Group {
            if let interval = state.restInterval {
                Text(timerInterval: interval, countsDown: true)
                    .foregroundStyle(restTint)
            } else {
                // `pauseTime` freezes the readout without the app streaming it.
                Text(timerInterval: state.elapsedInterval,
                     pauseTime: state.pausedAt,
                     countsDown: false)
                    .foregroundStyle(state.pausedAt == nil ? accent : .secondary)
            }
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    }
}

private struct SetsBar: View {
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        // Guarded: a workout with no sets yet would divide by zero.
        let fraction = state.setsTotal > 0
            ? Double(state.setsDone) / Double(state.setsTotal)
            : 0
        ProgressView(value: min(max(fraction, 0), 1))
            .tint(accent)
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(context.state.isResting ? "Rest" : "Training",
                      systemImage: context.state.isResting
                        ? "timer" : "figure.strengthtraining.traditional")
                    .font(.caption).fontWeight(.semibold)
                    .foregroundStyle(context.state.isResting ? restTint : accent)
                Spacer()
                Text(context.attributes.workoutName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    if context.state.isResting {
                        Text(context.state.restExerciseName ?? "Rest")
                            .font(.headline).lineLimit(1)
                        if let n = context.state.restSetNumber,
                           let total = context.state.restTotalSets {
                            Text("Set \(n) of \(total) done")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("\(context.state.setsDone) of \(context.state.setsTotal) sets")
                            .font(.headline)
                        Text(context.state.pausedAt == nil ? "In progress" : "Paused")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                PrimaryTimer(state: context.state, size: 34)
                    .frame(width: 118, alignment: .trailing)
            }

            if let interval = context.state.restInterval {
                ProgressView(timerInterval: interval, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .tint(restTint)
            } else {
                SetsBar(state: context.state)
            }
        }
        .padding()
    }
}
