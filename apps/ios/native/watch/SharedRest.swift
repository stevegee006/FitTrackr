import Foundation

/**
 The rest countdown, in storage both the watch app and its complication can
 read.

 A widget extension is a separate process, so a `@Published` property on
 `WorkoutManager` is invisible to it. The App Group container is the only
 shared surface, which is why this exists rather than the view reading the
 manager directly — the app and the complication must show the same countdown,
 and the only way to guarantee that is a single source both read.

 `endsAt` is an absolute instant, not a remaining duration. That is what lets
 both surfaces count down on their own — `Text(timerInterval:)` needs a fixed
 end — and it stays correct across a screen sleep, an app relaunch, and a
 widget refresh that happens minutes late. A stored "42 seconds remaining"
 would be a lie the moment anything paused.

 Add to the WATCH target, and to the complication target when that exists.
 */
struct RestState: Equatable {
    let endsAt: Date
    let exerciseName: String?
    let setNumber: Int?
    let totalSets: Int?

    /// Rest that has already elapsed is not rest. Both surfaces need this, and
    /// a widget woken after the countdown finished must not show a stale one.
    var isActive: Bool { endsAt > Date() }
}

enum SharedRest {
    /// Must match the App Groups capability on every target that reads it.
    static let appGroup = "group.com.geehive.fittrackr"

    private static let endsAtKey = "rest.endsAt"
    private static let exerciseKey = "rest.exerciseName"
    private static let setNumberKey = "rest.setNumber"
    private static let totalSetsKey = "rest.totalSets"

    private static var store: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static func write(_ rest: RestState?) {
        guard let store else { return }
        guard let rest else { return clear() }
        store.set(rest.endsAt.timeIntervalSince1970, forKey: endsAtKey)
        store.set(rest.exerciseName, forKey: exerciseKey)
        // `set(Int?)` is not a thing, and 0 is a plausible set number to
        // misread later, so absent values are removed rather than zeroed.
        if let n = rest.setNumber { store.set(n, forKey: setNumberKey) } else { store.removeObject(forKey: setNumberKey) }
        if let t = rest.totalSets { store.set(t, forKey: totalSetsKey) } else { store.removeObject(forKey: totalSetsKey) }
    }

    static func clear() {
        guard let store else { return }
        for key in [endsAtKey, exerciseKey, setNumberKey, totalSetsKey] {
            store.removeObject(forKey: key)
        }
    }

    /// Nil when there is no rest, or when the stored one has already expired.
    static func read() -> RestState? {
        guard let store else { return nil }
        let seconds = store.double(forKey: endsAtKey)
        guard seconds > 0 else { return nil }

        let rest = RestState(
            endsAt: Date(timeIntervalSince1970: seconds),
            exerciseName: store.string(forKey: exerciseKey),
            setNumber: store.object(forKey: setNumberKey) as? Int,
            totalSets: store.object(forKey: totalSetsKey) as? Int
        )
        return rest.isActive ? rest : nil
    }
}
