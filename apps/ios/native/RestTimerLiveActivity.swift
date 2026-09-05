import SwiftUI
import WidgetKit
import ActivityKit

/**
 Lock Screen and Dynamic Island presentation for the rest timer.

 THE KEY TRICK: `Text(timerInterval:)` and `ProgressView(timerInterval:)` count
 down **in the widget process, unaided**. The app hands over an end date once
 and never touches it again — no background execution, no APNs, no push
 entitlement, and therefore no paid Apple Developer account needed for the
 timer to work. Every update from the app is a real change (a new end time from
 ±10s, or the next set), never a tick.

 Add this file to the WIDGET EXTENSION target only.
 */

// Matches the app's indigo/emerald accents.
private let accent = Color(red: 0.39, green: 0.40, blue: 0.95)   // #6366f1
private let done = Color(red: 0.06, green: 0.72, blue: 0.51)     // #10b981

struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            LockScreenView(context: context)
                // Painted rather than left transparent, so it matches the app's
                // dark chrome instead of the system's translucent default.
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.exerciseName)
                            .font(.caption).fontWeight(.semibold)
                            .lineLimit(1)
                        Text("Set \(context.state.setNumber) of \(context.state.totalSets)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.interval, countsDown: true)
                        .font(.system(.title2, design: .rounded)).monospacedDigit()
                        .fontWeight(.bold)
                        .foregroundStyle(accent)
                        // Without a width the countdown jitters as digits change.
                        .frame(width: 68)
                        .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(timerInterval: context.state.interval, countsDown: true) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                    .tint(accent)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(accent)
            } compactTrailing: {
                Text(timerInterval: context.state.interval, countsDown: true)
                    .monospacedDigit()
                    .frame(width: 44)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(accent)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(accent)
            }
            .keylineTint(accent)
        }
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<RestTimerAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Rest", systemImage: "timer")
                    .font(.caption).fontWeight(.semibold)
                    .foregroundStyle(accent)
                Spacer()
                Text(context.attributes.workoutName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.exerciseName)
                        .font(.headline)
                        .lineLimit(1)
                    Text("Set \(context.state.setNumber) of \(context.state.totalSets)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(timerInterval: context.state.interval, countsDown: true)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .frame(width: 110)
                    .multilineTextAlignment(.trailing)
            }

            ProgressView(timerInterval: context.state.interval, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(accent)
        }
        .padding()
    }
}
