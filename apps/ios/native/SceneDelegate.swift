import UIKit
import Capacitor

/**
 Scene lifecycle adoption, required by the iOS 27 SDK.

 Building against iOS 27 with the legacy `UIApplicationDelegate`-only lifecycle
 does not warn — the app is KILLED at launch with
 "UIScene life cycle is required for apps built with this SDK", before the
 webview is ever pointed anywhere. What that looks like on a device is the
 splash never going away (see #120: the splash and an empty webview are the
 same colour), which sends you hunting for a network problem that does not
 exist. The Xcode console is the only place it says what actually happened.

 **This file deliberately differs from Capacitor's stock template.** The
 template writes:

 ```swift
 window = UIWindow(windowScene: windowScene)
 window?.rootViewController = CAPBridgeViewController()
 ```

 which would throw away `MainViewController` and take the server URL, the
 splash, the first-run prompt and the `WKNavigationDelegate` with it — leaving
 an app that launches, loads nothing, and offers no way to tell it where the
 server is. The failure is silent because `CAPBridgeViewController` is a
 perfectly working controller; it is just not OURS.

 `npx cap migrate` writes the stock version if no `SceneDelegate.swift` exists.
 That is fine and expected — the sync step in the README copies this file over
 the top afterwards, and the file name and target membership are unchanged, so
 the migration's Xcode wiring still applies.

 Add this file to the APP target (not the widget, not the watch).
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        /*
         The manifest sets `UISceneStoryboardFile` to "Main", so UIKit has
         normally built the window and its root from Main.storyboard before
         this runs, and `window` is already populated. The storyboard's initial
         controller is MainViewController — its class is set in the Identity
         Inspector, not in code, which is exactly why replacing the window here
         loses it with nothing to grep for.

         Keep what the storyboard gave us; only build a window if there isn't
         one, and go through the storyboard even then so the same controller is
         used either way.
         */
        if window == nil {
            let storyboard = UIStoryboard(name: "Main", bundle: nil)
            let root = storyboard.instantiateInitialViewController() ?? MainViewController()
            let created = UIWindow(windowScene: windowScene)
            created.rootViewController = root
            window = created
        }
        window?.makeKeyAndVisible()

        // Capacitor's own scene handling — plugin notifications, and the cold
        // start case where a URL or user activity arrives before plugins have
        // registered. Without this the bridge never hears about the scene.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
