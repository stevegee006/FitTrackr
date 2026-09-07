import Foundation
import UserNotifications
import UIKit

/**
 The "rest is over" alert on the phone.

 A LOCAL notification scheduled for the finish line, not a timer that fires
 when rest ends. The rest countdown itself lives in JavaScript, and iOS
 suspends the webview the moment the phone locks — which is exactly when the
 phone is in a pocket between sets and the alert matters most. Anything that
 depends on our code running at that instant does not fire.

 Scheduled by absolute date rather than a time interval, for the same reason
 `SharedRest` stores an end instant: it stays correct regardless of how long
 the message took to arrive.

 Add to the APP target.
 */
enum RestAlerts {
    /// One identifier, so scheduling again replaces rather than stacks. Adding
    /// ten seconds twice must not produce three notifications.
    private static let identifier = "fittrackr.rest.finished"

    /**
     Make the alert fire even while the app is on screen.

     By default iOS suppresses a local notification when its own app is
     foregrounded, on the reasonable assumption that the app can speak for
     itself. That assumption is wrong here: mid-set the phone is on a bench
     with the screen dark-but-awake, or the athlete is looking at the set list
     rather than the timer. The sound is the point, and it routes to whatever
     is playing — AirPods included.

     Retained by the static `shared`; `UNUserNotificationCenter.delegate` is a
     weak reference and a local object would be gone before delivery.
     */
    private final class Presenter: NSObject, UNUserNotificationCenterDelegate {
        static let shared = Presenter()

        func userNotificationCenter(
            _ center: UNUserNotificationCenter,
            willPresent notification: UNNotification,
            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
        ) {
            // A haptic as well as the sound. AirPods cover the audible half,
            // but a phone in a pocket with the ringer off has nothing else.
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            completionHandler([.banner, .sound, .list])
        }
    }

    /// Call once, before any rest can finish. `MainViewController` does it.
    static func installPresenter() {
        UNUserNotificationCenter.current().delegate = Presenter.shared
    }

    private static var askedForPermission = false

    /**
     Ask once, lazily.

     Not at launch: a permission prompt before the user has done anything is
     the kind that gets denied reflexively, and a denied prompt cannot be shown
     again. By the first rest timer the request has obvious context.
     */
    private static func ensureAuthorized(_ then: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                then(true)
            case .notDetermined:
                guard !askedForPermission else {
                    // Asked once this launch and the answer has not landed yet.
                    NSLog("[RestAlerts] permission request already in flight")
                    return then(false)
                }
                askedForPermission = true
                NSLog("[RestAlerts] requesting notification permission")
                center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                    NSLog("[RestAlerts] permission granted=\(granted) error=\(String(describing: error))")
                    then(granted)
                }
            default:
                // Denied, and iOS will not let us ask again — only Settings can
                // undo it. Logged rather than swallowed, because a silent
                // no-op here looks exactly like a broken timer.
                NSLog("[RestAlerts] notifications not permitted (status \(settings.authorizationStatus.rawValue))")
                then(false)
            }
        }
    }

    /**
     Schedule the alert for `endsAt`, replacing any already scheduled.

     `exerciseName` is worth carrying: between sets the useful thing is which
     lift is next, not that some timer somewhere expired.
     */
    static func schedule(endsAt: Date, exerciseName: String?, setNumber: Int?, totalSets: Int?) {
        // Already gone. Scheduling a date in the past delivers immediately,
        // which would fire an alert for a rest that finished while a message
        // was queued.
        guard endsAt.timeIntervalSinceNow > 0.5 else {
            NSLog("[RestAlerts] endsAt is in the past, cancelling")
            return cancel()
        }
        NSLog("[RestAlerts] scheduling for \(endsAt) (in \(Int(endsAt.timeIntervalSinceNow))s)")

        ensureAuthorized { granted in
            guard granted else { return }

            let content = UNMutableNotificationContent()
            content.title = "Rest complete"
            if let exerciseName, let setNumber, let totalSets {
                content.body = "\(exerciseName) — set \(setNumber + 1) of \(totalSets)"
            } else if let exerciseName {
                content.body = "Next up: \(exerciseName)"
            } else {
                content.body = "Time for your next set."
            }
            content.sound = .default
            content.interruptionLevel = .timeSensitive

            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: endsAt
            )
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

            let request = UNNotificationRequest(
                identifier: identifier, content: content, trigger: trigger
            )
            let center = UNUserNotificationCenter.current()
            center.removePendingNotificationRequests(withIdentifiers: [identifier])
            center.add(request) { error in
                if let error {
                    NSLog("[RestAlerts] add failed: \(error)")
                } else {
                    NSLog("[RestAlerts] scheduled ok")
                }
            }
        }
    }

    /// Rest ended early — skipped, or the next set ticked.
    static func cancel() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
