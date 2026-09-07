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

    /// Set by `WatchWorkoutPlugin` so a pause on the wrist reaches JavaScript.
    var onPauseChanged: ((Bool) -> Void)?
    /// Set by `WatchWorkoutPlugin` so the wrist can skip or adjust the rest.
    var onRestCommand: ((String, Int) -> Void)?

    /**
     True while a session this app started is recording on the wrist.

     Used to decide who alerts when rest ends. The watch buzzes from its own
     timer, and an iPhone notification mirrors to the watch whenever the phone
     is locked — so scheduling both means two alerts for one rest, on the same
     wrist, moments apart.
     */
    private(set) var watchSessionActive = false

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
                // For importing walks and rides recorded elsewhere.
                HKQuantityType(.distanceWalkingRunning),
                HKQuantityType(.distanceCycling),
            ]
        )
    }

    /**
     Workouts recorded ELSEWHERE, for importing.

     Anything in HealthKit whose source is not this app: the watch's own
     Workout app, Fitbod, Strava. The source filter is load-bearing rather than
     tidy — FitTrackr's own sessions are in HealthKit too, so without it every
     logged workout would come back as a duplicate of itself.

     A rolling window rather than an `HKAnchoredObjectQuery`. An anchor is more
     efficient and much less safe: it advances when read, so a failed upload
     loses those workouts permanently and silently. Re-sending 90 days on each
     app open costs a few kilobytes, and the server upserts on the workout UUID,
     so it is idempotent by construction.

     The trade is that deletions do not propagate — a workout deleted in Health
     stays in FitTrackr. Deliberate: silently deleting a logged workout because
     a sync said so is far worse than a stale row someone can remove.
     */
    func externalWorkouts(days: Int = 90) async -> [[String: Any]] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }

        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil)
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let samples: [HKWorkout] = await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: 300,
                sortDescriptors: [newestFirst]
            ) { _, samples, _ in
                continuation.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            healthStore.execute(query)
        }

        let ownPrefix = Bundle.main.bundleIdentifier ?? "com.geehive.fittrackr"
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"
        // The device calendar, so the day matches what the watch showed rather
        // than shifting across UTC midnight.
        dayFormatter.timeZone = .current

        let bpm = HKUnit.count().unitDivided(by: .minute())

        return samples.compactMap { workout in
            let source = workout.sourceRevision.source.bundleIdentifier
            // The phone app and the watch app share the prefix, so one check
            // covers everything FitTrackr wrote.
            if source.hasPrefix(ownPrefix) { return nil }

            var payload: [String: Any] = [
                "externalId": workout.uuid.uuidString,
                "logDate": dayFormatter.string(from: workout.startDate),
                "name": Self.activityName(workout.workoutActivityType),
                "workoutType": "CARDIO",
                "completedAt": ISO8601DateFormatter().string(from: workout.endDate),
                "durationMin": Int((workout.duration / 60).rounded()),
            ]

            if let distance = workout.statistics(for: HKQuantityType(.distanceWalkingRunning))?
                .sumQuantity()?.doubleValue(for: .meter()) {
                payload["distanceM"] = distance
            } else if let cycling = workout.statistics(for: HKQuantityType(.distanceCycling))?
                .sumQuantity()?.doubleValue(for: .meter()) {
                payload["distanceM"] = cycling
            }

            if let hr = workout.statistics(for: HKQuantityType(.heartRate))?
                .averageQuantity()?.doubleValue(for: bpm) {
                payload["avgHeartRateBpm"] = Int(hr.rounded())
            }

            if let kcal = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
                .sumQuantity()?.doubleValue(for: .kilocalorie()) {
                payload["activeEnergyKcal"] = Int(kcal.rounded())
            }

            return payload
        }
    }

    /// Readable names for the activity types worth naming; everything else
    /// falls back to "Workout" rather than an enum number nobody can read.
    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .walking: return "Outdoor Walk"
        case .running: return "Run"
        case .cycling: return "Cycling"
        case .hiking: return "Hike"
        case .swimming: return "Swim"
        case .rowing: return "Rowing"
        case .elliptical: return "Elliptical"
        case .stairClimbing: return "Stair Climbing"
        case .highIntensityIntervalTraining: return "HIIT"
        case .traditionalStrengthTraining: return "Strength Training"
        case .functionalStrengthTraining: return "Functional Strength"
        case .coreTraining: return "Core Training"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .flexibility: return "Stretching"
        case .boxing: return "Boxing"
        case .kickboxing: return "Kickboxing"
        case .tennis: return "Tennis"
        case .basketball: return "Basketball"
        case .soccer: return "Soccer"
        case .golf: return "Golf"
        case .cooldown: return "Cooldown"
        case .mixedCardio: return "Mixed Cardio"
        default: return "Workout"
        }
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
        watchSessionActive = true

        // The configuration carries no arbitrary metadata, so the name follows
        // separately — cosmetic only, and safe to lose.
        send(["action": "name", "workoutName": name])
    }

    func stopWorkout() {
        watchSessionActive = false
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

    // The watch reports pause state back. Both delivery paths land here for
    // the same reason as on the watch side: `sendMessage` needs reachability,
    // `transferUserInfo` queues.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        handle(userInfo)
    }

    private func handle(_ payload: [String: Any]) {
        switch payload["action"] as? String {
        case "pauseState":
            guard let paused = payload["paused"] as? Bool else { return }
            DispatchQueue.main.async { self.onPauseChanged?(paused) }
        case "restCommand":
            // The wrist asks; the phone decides. The rest timer's state lives
            // in the web app, which owns the finish line the Live Activity and
            // the watch both render — so the watch reports an intent rather
            // than adjusting a clock of its own that would then disagree.
            guard let command = payload["command"] as? String else { return }
            let delta = payload["delta"] as? Int ?? 0
            DispatchQueue.main.async { self.onRestCommand?(command, delta) }
        default:
            break
        }
    }
}
