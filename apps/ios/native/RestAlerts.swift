import Foundation
import UserNotifications

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
                guard !askedForPermission else { return then(false) }
                askedForPermission = true
                center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    then(granted)
                }
            default:
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
        guard endsAt.timeIntervalSinceNow > 0.5 else { return cancel() }

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
            center.add(request)
        }
    }

    /// Rest ended early — skipped, or the next set ticked.
    static func cancel() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
