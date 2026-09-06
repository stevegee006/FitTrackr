import Foundation
import WatchConnectivity
import Combine

/**
 The watch half of the phone link.

 Only three messages exist, all from phone to watch: `start` (belt and braces —
 `startWatchApp` already launches us into a session), `stop`, and `name`.
 Nothing is sent back: the phone keeps its own clock and set counts, so the
 watch has nothing the phone needs.

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
            default:
                break
            }
        }
    }
}
