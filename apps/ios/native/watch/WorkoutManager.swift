import Foundation
import HealthKit
import Combine
import WidgetKit

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

    /// In a session — running OR paused. Deliberately not "not paused": the
    /// view uses this to decide between the workout UI and the idle prompt,
    /// and a paused workout must not look like no workout.
    @Published var isRunning = false
    @Published var isPaused = false
    @Published var startedAt: Date?
    /**
     What `Text(timerInterval:)` counts up from.

     Not `startedAt`, because pausing has to be subtracted. On resume this is
     moved forward to `now - elapsed`, so the self-counting text shows total
     working time without anything here ticking. `startedAt` stays as the real
     beginning of the session, which is what HealthKit records.
     */
    @Published var timerAnchor: Date?
    /// Frozen elapsed time to display while paused, since nothing is counting.
    @Published var pausedElapsed: TimeInterval = 0
    @Published var heartRate: Double = 0
    @Published var activeEnergyKcal: Double = 0
    /// Sent from the phone so the watch face shows which session this is.
    @Published var workoutName: String = "Workout"
    /**
     The rest countdown, pushed from the phone.

     Held as an absolute end instant rather than a remaining duration so the
     view can count down on its own — no ticking here, and still correct after
     the screen sleeps. Mirrored into the App Group so the complication reads
     exactly what the app is showing.
     */
    @Published var rest: RestState?

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
            timerAnchor = begin
            isRunning = true
            isPaused = false
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

    // MARK: - Pause

    /**
     Pause or resume the session on the wrist.

     Commands only — the published state is updated by the session delegate,
     not here. That is what makes pausing from the watch's own system card
     (the Smart Stack shows one, with a pause button) behave identically to
     pausing from the phone. Setting the flags here as well would give two
     writers and a UI that disagrees with the session it is describing.

     Pausing matters for more than the clock: a session left running keeps
     sampling heart rate and accruing active energy through the rest, which
     inflates the workout HealthKit ends up saving.
     */
    func setPaused(_ paused: Bool) {
        guard let session, isRunning else { return }
        if paused, session.state == .running {
            session.pause()
        } else if !paused, session.state == .paused {
            session.resume()
        }
    }

    // MARK: - Rest

    /**
     Show, replace, or clear the rest countdown.

     Idempotent by design, like the Live Activity's `sync`: the phone sends
     whatever the current state is, and passing nil ends the countdown. The
     watch never decides on its own that rest is over — skipping a rest, adding
     ten seconds, or ticking the next set all arrive as another call, so the two
     cannot drift.
     */
    func setRest(_ rest: RestState?) {
        // Already-elapsed rest is not rest. A message delayed by a queued
        // transfer would otherwise start a countdown that finished minutes ago.
        let live = (rest?.isActive ?? false) ? rest : nil
        self.rest = live
        SharedRest.write(live)
        // The complication is a separate process and does not see the write.
        // Cheap because it happens on rest START and END only, not per second
        // — the countdown itself animates without us.
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func reset() {
        session = nil
        builder = nil
        isRunning = false
        isPaused = false
        startedAt = nil
        timerAnchor = nil
        pausedElapsed = 0
        heartRate = 0
        activeEnergyKcal = 0
        // The session is over, so any countdown belongs to it and goes too.
        // Left behind, a complication would show a rest from a finished
        // workout until it happened to expire.
        rest = nil
        SharedRest.clear()
        WidgetCenter.shared.reloadAllTimelines()
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
            switch toState {
            case .running:
                self.isRunning = true
                self.isPaused = false
                // Re-anchor so the counting text excludes the paused stretch.
                // `builder.elapsedTime` already discounts it, which is why it
                // is read rather than tracked here.
                let elapsed = self.builder?.elapsedTime ?? 0
                self.timerAnchor = Date().addingTimeInterval(-elapsed)
                // Reported from the delegate, not the call site, so a pause
                // from the system's own Smart Stack card reaches the phone
                // exactly like one from our button.
                WatchConnector.shared.reportPaused(false)
            case .paused:
                // NOT `isRunning = false` — that is the idle state, and a
                // paused workout showing "start a workout" would be a lie.
                self.isRunning = true
                self.isPaused = true
                self.pausedElapsed = self.builder?.elapsedTime ?? 0
                WatchConnector.shared.reportPaused(true)
            case .ended:
                // The session can end without us asking — the watch being
                // removed, or the system reclaiming it. Treat that as a stop
                // so the UI does not sit claiming to record something it is
                // not.
                self.reset()
            default:
                break
            }
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
