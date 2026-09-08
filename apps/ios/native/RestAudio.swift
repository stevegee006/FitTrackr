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

 `.mixWithOthers` and `.duckOthers` together mean a podcast keeps playing and
 simply dips under the chime, instead of being stopped.

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
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.mixWithOthers, .duckOthers]
            )
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
        cancelChime()

        let delay = endsAt.timeIntervalSinceNow
        // Already gone. A message that spent time queued must not fire a chime
        // for a rest that finished while it was in flight.
        guard delay > 0.5 else { return }

        timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            playChime()
        }
        // Fires while the app is backgrounded, which the default run-loop mode
        // does not guarantee.
        RunLoop.main.add(timer!, forMode: .common)
    }

    static func cancelChime() {
        timer?.invalidate()
        timer = nil
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
