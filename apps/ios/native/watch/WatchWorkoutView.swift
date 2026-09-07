import SwiftUI

/**
 What you see on the wrist mid-set: the rest countdown when one is running,
 otherwise heart rate, elapsed, active calories, and a way to stop.

 Rest takes over the whole screen rather than sitting alongside the stats. It
 is the only thing that matters while it is running, it is read at arm's length
 between sets, and a glanceable countdown beats a complete dashboard. The stats
 are still one tap away — and still on the phone, which is where the session is
 actually being logged.

 Stopping from the watch is deliberate. The phone normally ends the session
 when you press Finish, but if the phone is across the gym, in a locker, or
 dead, the session must still be endable — an HKWorkoutSession left running
 burns battery and eventually gets killed by the system, saving nothing.

 Add to the WATCH target only.
 */
struct WatchWorkoutView: View {
    @StateObject private var manager = WorkoutManager.shared

    var body: some View {
        VStack(spacing: 6) {
            if let rest = manager.rest, rest.isActive {
                restView(rest)
            } else if manager.isRunning {
                Text(manager.workoutName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let startedAt = manager.startedAt {
                    // Counts on its own, like the Live Activity — no ticking
                    // from our code, and correct after the screen wakes.
                    Text(timerInterval: startedAt...startedAt.addingTimeInterval(60 * 60 * 24),
                         countsDown: false)
                        .font(.system(.title2, design: .rounded))
                        .fontWeight(.bold)
                        .monospacedDigit()
                }

                HStack(spacing: 10) {
                    Label(
                        manager.heartRate > 0 ? "\(Int(manager.heartRate))" : "--",
                        systemImage: "heart.fill"
                    )
                    .foregroundStyle(.red)

                    Label("\(Int(manager.activeEnergyKcal))", systemImage: "flame.fill")
                        .foregroundStyle(.orange)
                }
                .font(.caption)

                Button("End") {
                    Task { await manager.stop() }
                }
                .tint(.red)
            } else {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.title2)
                    .foregroundStyle(.indigo)
                Text("Start a workout in FitTrackr on your iPhone")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                // A manual start, for when the phone is not to hand.
                Button("Start here") {
                    Task { await manager.start(name: nil) }
                }
                .tint(.indigo)
            }
        }
        .padding(.horizontal, 4)
        .task { await manager.requestAuthorization() }
    }

    /**
     The countdown.

     `Text(timerInterval:countsDown:)` counts on its own, so nothing here ticks
     and the number is correct the instant the screen wakes — the same reason
     the Live Activity uses it. A `Timer` publisher would stop while the app is
     suspended and resume showing a stale value.
     */
    @ViewBuilder
    private func restView(_ rest: RestState) -> some View {
        VStack(spacing: 4) {
            Text("REST")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.teal)

            Text(timerInterval: Date()...rest.endsAt, countsDown: true)
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)

            if let name = rest.exerciseName {
                Text(name)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            // "Set 2 of 4" is what tells you whether to reach for the water or
            // get back under the bar, so it earns its line.
            if let set = rest.setNumber, let total = rest.totalSets {
                Text("Set \(set) of \(total)")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
