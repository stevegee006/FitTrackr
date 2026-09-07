import Foundation
import WatchConnectivity
import HealthKit

/**
 The phone half of the watch link.

 Two jobs: launch the watch app into a workout, and tell it to stop.

 **`HKHealthStore.startWatchApp(with:)` is the only way an iPhone can start a
 watch app.** There is no general launch API. It hands the watch an
 `HKWorkoutConfiguration`, which arrives in the watch app's
 `WKApplicationDelegate.handle(_:)` — so the watch begins recording without
 anyone touching it, which is the entire point of this feature.

 WatchConnectivity carries everything after that. Note the deliberate use of
 `transferUserInfo` rather than `sendMessage` for stop: `sendMessage` requires
 the watch to be reachable right then, and a stop that silently fails leaves a
 workout session running on the wrist until the system kills it — losing the
 session. `transferUserInfo` queues and delivers.

 Add to the APP target (not the widget, not the watch).
 */
final class PhoneWatchConnector: NSObject {
    static let shared = PhoneWatchConnector()

    private let healthStore = HKHealthStore()

    private override init() {
        super.init()
        activate()
    }

    /// Idempotent — safe to call on every launch path.
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated { session.activate() }
    }

    /**
     Wait for the session to activate before reading anything from it.

     `isPaired` and `isWatchAppInstalled` are meaningless until activation
     completes: they report `false`, which is indistinguishable from "no watch
     is paired". Because the singleton activates when it is first touched, the
     first call after launch would always answer false and every later one
     true — the app would claim to have no watch exactly once per launch, and
     the first workout of a session would silently skip the wrist.

     Polled rather than continuation-based on purpose. This runs once at
     launch, never in a hot path, and a bounded poll cannot hang the caller if
     the delegate never fires — whereas a stranded continuation leaves the
     JavaScript promise pending forever.
     */
    func waitUntilActivated() async {
        guard WCSession.isSupported() else { return }
        activate()
        for _ in 0..<30 {
            if WCSession.default.activationState == .activated { return }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    var isPaired: Bool {
        WCSession.isSupported() && WCSession.default.isPaired
    }

    var isWatchAppInstalled: Bool {
        WCSession.isSupported() && WCSession.default.isWatchAppInstalled
    }

    /// Health permission for the workout itself; the watch asks for its own.
    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        try await healthStore.requestAuthorization(
            toShare: [HKQuantityType.workoutType()],
            read: [
                HKQuantityType.workoutType(),
                HKQuantityType(.heartRate),
                // Needed to read the session's energy back afterwards. Missing
                // it does not fail loudly — the statistics simply come back
                // nil, which reads as "the watch measured nothing".
                HKQuantityType(.activeEnergyBurned),
            ]
        )
    }

    /**
     What the watch actually measured, read back after HealthKit saves it.

     Matched by TIME rather than by identifier, because the phone never learns
     the workout's UUID — the watch owns the session and saves it on its own
     side. The window starts a minute before the session did, to tolerate the
     small disagreement between the phone's clock reading and the sample the
     watch actually anchored to.

     Returns nil when there is nothing yet. That is the normal case for the
     first few seconds after finishing: `finishWorkout()` on the wrist and the
     sample arriving in the phone's HealthKit store are not the same instant,
     and the caller is expected to retry rather than treat it as "no data".
     */
    func workoutSummary(startedAt: Date) async -> (avgHeartRate: Int?, activeEnergyKcal: Int?)? {
        guard HKHealthStore.isHealthDataAvailable() else { return nil }

        // Narrowed to the activity type this app records. Without it the newest
        // workout in the window could easily be an Outdoor Walk the watch
        // logged on its own, and its heart rate would be written to a lifting
        // session as if it were the truth.
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(
                withStart: startedAt.addingTimeInterval(-60),
                end: nil,
                options: .strictStartDate
            ),
            HKQuery.predicateForWorkouts(with: .traditionalStrengthTraining),
        ])
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let workout: HKWorkout? = await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: 1,
                sortDescriptors: [newestFirst]
            ) { _, samples, _ in
                continuation.resume(returning: samples?.first as? HKWorkout)
            }
            healthStore.execute(query)
        }

        guard let workout else { return nil }

        let bpm = HKUnit.count().unitDivided(by: .minute())
        let heart = workout.statistics(for: HKQuantityType(.heartRate))?
            .averageQuantity()?.doubleValue(for: bpm)
        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity()?.doubleValue(for: .kilocalorie())

        // Rounded here rather than in JavaScript: 138.4 bpm is false precision
        // for a workout summary, and the column is an integer.
        return (
            heart.map { Int($0.rounded()) },
            energy.map { Int($0.rounded()) }
        )
    }

    func startWorkout(named name: String) async throws {
        await waitUntilActivated()
        try await requestAuthorization()

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        try await healthStore.startWatchApp(toHandle: config)

        // The configuration carries no arbitrary metadata, so the name follows
        // separately — cosmetic only, and safe to lose.
        send(["action": "name", "workoutName": name])
    }

    func stopWorkout() {
        send(["action": "stop"])
    }

    /**
     Pause or resume the session on the wrist.

     State, not an event: the phone sends whether it is paused, so a missed
     message is corrected by the next one rather than leaving the two clocks
     permanently disagreeing.
     */
    func sendPaused(_ paused: Bool) {
        send(["action": "pause", "paused": paused])
    }

    /**
     Push the rest countdown to the wrist.

     `endsAt` nil means rest is over — skipped, or the next set ticked. Sent as
     the same message rather than a separate "clear" so the watch never has to
     infer the end, and a lost clear cannot leave a countdown running.

     Sent as an absolute instant. A remaining-seconds value would be wrong by
     however long the message spent queued, which for a `transferUserInfo` to a
     sleeping watch can be a while.
     */
    func sendRest(endsAt: Date?, exerciseName: String?, setNumber: Int?, totalSets: Int?) {
        var payload: [String: Any] = ["action": "rest"]
        if let endsAt {
            payload["restEndsAt"] = endsAt.timeIntervalSince1970 * 1000
            if let exerciseName { payload["restExerciseName"] = exerciseName }
            if let setNumber { payload["restSetNumber"] = setNumber }
            if let totalSets { payload["restTotalSets"] = totalSets }
        }
        send(payload)
    }

    private func send(_ payload: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { _ in
                // Reachability can lapse between the check and the send.
                session.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }
}

extension PhoneWatchConnector: WCSessionDelegate {
    func session(_ session: WCSession,
                 activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {}

    // Both are required on iOS. Reactivating is what lets a second paired
    // watch work without relaunching the app.
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
