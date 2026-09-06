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
            read: [HKQuantityType.workoutType(), HKQuantityType(.heartRate)]
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
