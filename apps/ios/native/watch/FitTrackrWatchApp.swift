import SwiftUI
import HealthKit

/**
 Entry point for the watch app.

 The delegate matters as much as the view: `handle(_ workoutConfiguration:)` is
 what iOS calls when the phone runs `HKHealthStore.startWatchApp(with:)`. That
 is the only way an iPhone can bring a watch app to life — there is no general
 "launch my watch app" API — so without this the phone can start nothing and
 the whole point of the app is lost.

 Add these to the WATCH target only.
 */
@main
struct FitTrackrWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            WatchWorkoutView()
                .onAppear { WatchConnector.shared.activate() }
        }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        WatchConnector.shared.activate()
    }

    /// Launched by the phone for a workout — start recording immediately.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in
            await WorkoutManager.shared.start(name: nil)
        }
    }
}
