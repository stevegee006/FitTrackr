import SwiftUI

/**
 What you see on the wrist mid-set: heart rate, elapsed, active calories, and a
 way to stop.

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
            if manager.isRunning {
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
}
