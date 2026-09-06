import Foundation
import HealthKit
import Combine

/**
 The actual workout recording, on the watch.

 This is the whole point of the watch app: an `HKWorkoutSession` with a
 `HKLiveWorkoutBuilder` is what samples heart rate and derives active energy
 from it. A workout written from the phone has neither, and so earns no honest
 Move-ring credit — only a session running on the watch does.

 Add to the WATCH target only.
 */
@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    @Published var isRunning = false
    @Published var startedAt: Date?
    @Published var heartRate: Double = 0
    @Published var activeEnergyKcal: Double = 0
    /// Sent from the phone so the watch face shows which session this is.
    @Published var workoutName: String = "Workout"

    private override init() { super.init() }

    // MARK: - Authorisation

    /// Everything the live builder needs to collect, plus the workout to save.
    private var shareTypes: Set<HKSampleType> {
        [
            HKQuantityType.workoutType(),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.heartRate),
        ]
    }

    private var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType.workoutType(),
        ]
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        try? await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
    }

    // MARK: - Session

    /**
     Begin recording.

     `.traditionalStrengthTraining` with `.indoor` is what the Fitness app
     shows as a strength workout — matching the type matters, because Apple
     uses it to pick the energy model.
     */
    func start(name: String?) async {
        guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
        if let name { workoutName = name }

        await requestAuthorization()

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: config
            )
            session.delegate = self
            builder.delegate = self

            self.session = session
            self.builder = builder

            let begin = Date()
            session.startActivity(with: begin)
            try await builder.beginCollection(at: begin)

            startedAt = begin
            isRunning = true
        } catch {
            // Nothing to surface on the watch beyond staying stopped; the phone
            // keeps its own clock either way.
            reset()
        }
    }

    /**
     Stop and SAVE.

     `finishWorkout()` is what writes the HKWorkout — with heart rate and
     active energy attached — into Health, where the Fitness app and the rings
     pick it up. Ending the session without finishing the builder records
     nothing, which is a silent way to lose a whole session.
     */
    func stop() async {
        guard let session, let builder else { return }

        let end = Date()
        session.end()

        do {
            try await builder.endCollection(at: end)
            _ = try await builder.finishWorkout()
        } catch {
            // Nothing useful to do — the session is over regardless.
        }
        reset()
    }

    private func reset() {
        session = nil
        builder = nil
        isRunning = false
        startedAt = nil
        heartRate = 0
        activeEnergyKcal = 0
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        Task { @MainActor in
            self.isRunning = (toState == .running)
            // The session can end without us asking — the watch being removed,
            // or the system reclaiming it. Treat that as a stop so the UI does
            // not sit claiming to record something that is not.
            if toState == .ended { self.reset() }
        }
    }

    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didFailWithError error: Error
    ) {
        Task { @MainActor in self.reset() }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let statistics = workoutBuilder.statistics(for: quantityType) else { continue }

            if quantityType == HKQuantityType(.heartRate) {
                let bpm = HKUnit.count().unitDivided(by: .minute())
                let value = statistics.mostRecentQuantity()?.doubleValue(for: bpm) ?? 0
                Task { @MainActor in self.heartRate = value }
            }

            if quantityType == HKQuantityType(.activeEnergyBurned) {
                let value = statistics.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
                Task { @MainActor in self.activeEnergyKcal = value }
            }
        }
    }
}
