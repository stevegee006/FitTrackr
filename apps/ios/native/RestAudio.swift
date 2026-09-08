import Foundation
import AVFoundation

/**
 The audible end-of-rest alert, played by the app rather than by a notification.

 **Why not just a notification sound.** The ring/silent switch suppresses every
 notification sound, unconditionally, and there is no flag that overrides it
 short of Apple's Critical Alerts entitlement (which requires their approval).
 A phone that lives on silent — which is most phones in a gym — therefore gets
 a banner and nothing else. An `AVAudioSession` set to `.playback` ignores the
 silent switch by design, which is how every interval-timer app manages to
 beep.

 **Why the silent loop.** Playing audio needs the app to be running, and iOS
 suspends it seconds after the phone locks. The Background Audio mode keeps an
 app alive only while it is actually playing something, so a one-second file of
 silence is looped for the duration of the workout. It is a well-worn trick
 rather than a clever one, and it is the only way to make a sound happen at a
 chosen instant on a locked phone without a server pushing it.

 The cost is real and worth stating: a workout holds an audio session open, so
 there is a battery penalty for as long as the clock runs, and the session ends
 the moment the workout is finished rather than lingering.

 **Ducking is switched on around the chime and off again**, not left on for the
 session. `.duckOthers` applies for as long as the session is active, and this
 session is active for the whole workout — so setting it once meant music
 dipped the moment the clock started and stayed dipped for an hour. The
 keep-alive runs mix-only; the chime raises ducking for its own duration and
 lowers it again.

 Add to the APP target, along with `rest-chime.wav` and `silence.wav`, and tick
 **Background Modes → Audio** on that target — without it the app is suspended
 on lock and the chime never fires.
 */
enum RestAudio {
    private static var keepAlive: AVAudioPlayer?
    private static var chime: AVAudioPlayer?
    private static var timer: Timer?

    // MARK: - Session

    /**
     Begin holding the audio session, for the length of the workout.

     Idempotent: `startClock` fires this, and so does every re-sync of the Live
     Activity, so it must be safe to call repeatedly.
     */
    static func beginSession() {
        guard keepAlive == nil else { return }

        do {
            let session = AVAudioSession.sharedInstance()
            // Mix ONLY. Ducking here would dim the music for the whole workout.
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            guard let url = Bundle.main.url(forResource: "silence", withExtension: "wav") else {
                NSLog("[RestAudio] silence.wav missing from the bundle")
                return
            }
            let player = try AVAudioPlayer(contentsOf: url)
            player.numberOfLoops = -1
            player.volume = 0
            player.play()
            keepAlive = player
            NSLog("[RestAudio] session held")
        } catch {
            NSLog("[RestAudio] could not hold the session: \(error)")
        }
    }

    /// The workout is over. Release everything — an audio session held past the
    /// session it belongs to is a battery drain with nothing to show for it.
    static func endSession() {
        cancelChime()
        keepAlive?.stop()
        keepAlive = nil
        chime = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        NSLog("[RestAudio] session released")
    }

    // MARK: - Chime

    /**
     Play the chime at `endsAt`, replacing anything already scheduled.

     A timer rather than a scheduled sound, because the session above keeps the
     app awake to fire it. Replacing rather than adding matters: pressing +10s
     twice must move one chime, not queue three.
     */
    static func scheduleChime(at endsAt: Date) {
        let delay = endsAt.timeIntervalSinceNow

        /*
         On the MAIN queue, and that is the whole point of this hop.

         Capacitor dispatches plugin calls on a background queue, and
         `Timer.scheduledTimer` attaches to the CURRENT thread's run loop —
         which on a dispatch queue thread is not running. The timer was created
         successfully, held a reference, reported no error, and simply never
         fired. Nothing in the logs said so; the chime was just silent.

         `.common` mode on top, because the default mode stops being serviced
         during some UI interactions.
         */
        DispatchQueue.main.async {
            cancelChime()

            // Already gone. A message that spent time queued must not fire a
            // chime for a rest that finished while it was in flight.
            guard delay > 0.5 else { return }

            let t = Timer(timeInterval: delay, repeats: false) { _ in
                playChime()
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
            NSLog("[RestAudio] chime scheduled in \(Int(delay))s")
        }
    }

    static func cancelChime() {
        timer?.invalidate()
        timer = nil
    }

    /// Play it now. Used to prove the chain end-to-end without waiting out a
    /// rest, and by the watch-command path when rest is skipped.
    static func testChime() {
        DispatchQueue.main.async { playChime() }
    }

    /**
     Duck other audio for the length of the chime, then stop ducking.

     A category change rather than a volume change, because we do not control
     the other app's player. The revert is on a delay rather than a delegate
     callback so there is one code path whether or not the file plays — a
     failed chime that left ducking on would dim the music silently for the
     rest of the workout.
     */
    private static func duck(for duration: TimeInterval) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
            .playback, mode: .default, options: [.mixWithOthers, .duckOthers]
        )
        try? session.setActive(true)

        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.3) {
            // Only lower it if a workout is still running; endSession has its
            // own teardown and should not be undone from here.
            guard keepAlive != nil else { return }
            try? session.setCategory(
                .playback, mode: .default, options: [.mixWithOthers]
            )
        }
    }

    private static func playChime() {
        // The session is normally already held, but a rest can outlive a
        // workout that was never properly started — so make sure.
        beginSession()

        guard let url = Bundle.main.url(forResource: "rest-chime", withExtension: "wav") else {
            NSLog("[RestAudio] rest-chime.wav missing from the bundle")
            return
        }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.volume = 1
            player.prepareToPlay()
            duck(for: player.duration)
            player.play()
            // Held: an AVAudioPlayer that goes out of scope stops immediately,
            // which is a silent bug that looks like a missing file.
            chime = player
            NSLog("[RestAudio] chime played")
        } catch {
            NSLog("[RestAudio] chime failed: \(error)")
        }
    }
}
