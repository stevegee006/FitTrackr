import Foundation
import WatchConnectivity
import Combine

/**
 The watch half of the phone link.

 Five messages from phone to watch: `start` (belt and braces —
 `startWatchApp` already launches us into a session), `stop`, `name`, `rest`,
 and `pause`.

 **One goes back:** `pauseState`. Pause is the only thing either device can
 change, so it is the only thing that needs reporting — pausing on the wrist
 while the phone kept counting would leave two clocks disagreeing, and the
 phone's is the one written to the workout. Everything else the watch knows,
 the phone knew first.

 Add to the WATCH target only.
 */
final class WatchConnector: NSObject, ObservableObject {
    static let shared = WatchConnector()

    private override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Called from the app's init so the session is live before any message.
    func activate() { _ = WatchConnector.shared }

    /**
     Tell the phone the session was paused or resumed on the wrist.

     Sent even when the phone asked for it in the first place. The echo is
     harmless — both sides treat pause as idempotent state — and the
     alternative, tracking who initiated each change, is exactly the kind of
     bookkeeping that ends up wrong in the case nobody tested.
     */
    func reportPaused(_ paused: Bool) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let payload: [String: Any] = ["action": "pauseState", "paused": paused]

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { _ in
                session.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }
}

extension WatchConnector: WCSessionDelegate {
    func session(_ session: WCSession,
                 activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {}

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message)
    }

    /// `sendMessage` needs the watch reachable; `transferUserInfo` queues instead.
    /// Both land here so a stop is not lost because the watch was asleep.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        handle(userInfo)
    }

    private func handle(_ payload: [String: Any]) {
        let action = payload["action"] as? String
        let name = payload["workoutName"] as? String

        Task { @MainActor in
            switch action {
            case "start":
                await WorkoutManager.shared.start(name: name)
            case "stop":
                await WorkoutManager.shared.stop()
            case "name":
                if let name { WorkoutManager.shared.workoutName = name }
            case "pause":
                WorkoutManager.shared.setPaused(payload["paused"] as? Bool ?? false)
            case "rest":
                // No `endsAt` means rest is over — skipped, or the next set
                // ticked. Sending a clear as the same message keeps the watch
                // from having to infer it.
                let endsAtMs = payload["restEndsAt"] as? Double
                WorkoutManager.shared.setRest(endsAtMs.map { ms in
                    RestState(
                        endsAt: Date(timeIntervalSince1970: ms / 1000),
                        exerciseName: payload["restExerciseName"] as? String,
                        setNumber: payload["restSetNumber"] as? Int,
                        totalSets: payload["restTotalSets"] as? Int
                    )
                })
            default:
                break
            }
        }
    }
}
