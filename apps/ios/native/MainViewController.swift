import UIKit
import Capacitor
import WebKit

/**
 The app's root view controller, replacing Capacitor's stock bridge controller
 so the server URL can come from `UserDefaults` instead of the bundled config.

 To wire it up in Xcode: open `App/Base.lproj/Main.storyboard`, select the
 "Bridge View Controller" scene, and in the Identity Inspector change its class
 from `CAPBridgeViewController` to `MainViewController` (module: App).

 Two jobs beyond that:

  1. **First run** — with no host stored, ask for one before loading anything.
     Otherwise a friend's fresh install would sit on the author's server.
  2. **Unreachable host** — if the configured server fails to load, offer the
     prompt again. Without this, one typo locks you out of the app permanently
     with no way back short of deleting it.
 */
class MainViewController: CAPBridgeViewController {

    /// Capacitor reads this to build its configuration, before the webview loads.
    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let url = ServerConfig.current {
            descriptor.serverURL = url.absoluteString
        }
        return descriptor
    }

    /**
     Register the app's own plugins.

     Capacitor 6+ does NOT discover plugins by scanning the Objective-C
     runtime any more — it instantiates the classes named in
     `packageClassList`, which the CLI generates from installed npm packages.
     A plugin that lives in the app rather than in a package is therefore never
     loaded, no matter how correctly it is written: it compiles, the app runs,
     and `Capacitor.Plugins` simply lacks it, with no error anywhere.

     `capacitorDidLoad()` is the supported hook for exactly this, and it
     survives `cap sync` — editing the generated capacitor.config.json would
     not.
     */
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WorkoutActivityPlugin())
        bridge?.registerPluginInstance(ServerConfigPlugin())
        bridge?.registerPluginInstance(WatchWorkoutPlugin())

        // Begin WCSession activation now rather than on first use. Activation
        // is asynchronous, and anything that reads the session before it
        // completes is told there is no watch.
        PhoneWatchConnector.shared.activate()
    }

    private var hasPromptedOnLaunch = false

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.navigationDelegate = self
    }

    /**
     Ask for a server on first run.

     In `viewDidAppear`, NOT `viewDidLoad`: presenting a `UIAlertController`
     from `viewDidLoad` fails silently because the view is not in the window
     hierarchy yet. UIKit logs a warning at most, and the app simply sits on
     the placeholder with no way to enter anything — which is what it did.

     Prompt whenever the user has not CHOSEN a server, rather than only when
     the build ships without one. Builds no longer carry a default at all, but
     the distinction still matters: anyone installing a build made by someone
     else must not silently land on that person's instance, staring at a login
     for an account they do not have, with the in-app setting behind it.
     */
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasPromptedOnLaunch, !ServerConfig.isConfigured else { return }
        hasPromptedOnLaunch = true
        promptForServer(reason: "Which FitTrackr server should this app use?")
    }

    // MARK: - Prompt

    /**
     Native, not web: when the configured host is wrong there is no web app to
     render a form, which is precisely when this is needed most.
     */
    func promptForServer(reason: String) {
        // Guard against stacking prompts if several navigations fail at once.
        if presentedViewController is UIAlertController { return }

        let alert = UIAlertController(
            title: "FitTrackr server",
            message: reason,
            preferredStyle: .alert
        )

        alert.addTextField { field in
            field.placeholder = "fittrackr.example.com"
            field.text = ServerConfig.currentString
            field.keyboardType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.clearButtonMode = .whileEditing
        }

        alert.addAction(UIAlertAction(title: "Connect", style: .default) { [weak self, weak alert] _ in
            let entered = alert?.textFields?.first?.text ?? ""
            guard ServerConfig.set(entered) != nil else {
                // Re-present on the next runloop turn; presenting from inside
                // the dismissal of another alert is dropped.
                DispatchQueue.main.async {
                    self?.promptForServer(
                        reason: "That address doesn't look right. Use https, or a local network address."
                    )
                }
                return
            }
            self?.loadConfiguredServer()
        })

        // No Cancel when there is nowhere to cancel BACK to. Dismissing the
        // only way to enter a host leaves the app on a placeholder with no
        // route to the setting, recoverable only by deleting and reinstalling.
        if ServerConfig.current != nil {
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        }
        present(alert, animated: true)
    }

    /**
     Point the existing webview at a new host.

     The Capacitor bridge script is injected as a `WKUserScript` at document
     start, so it runs on whatever document the webview loads and the plugins
     keep working across the switch. `server.allowNavigation` in
     capacitor.config.ts is what permits leaving the original origin at all.

     If anything does misbehave after switching, relaunching the app is the
     clean path — on the next launch `instanceDescriptor()` returns the new URL
     and it is an ordinary `server.url` from the start.
     */
    func loadConfiguredServer() {
        guard let url = ServerConfig.current else {
            promptForServer(reason: "Enter the address of your FitTrackr server.")
            return
        }
        webView?.load(URLRequest(url: url))
    }
}

extension MainViewController: WKNavigationDelegate {
    public func webView(_ webView: WKWebView,
                        didFailProvisionalNavigation navigation: WKNavigation!,
                        withError error: Error) {
        // -999 is "cancelled", which happens routinely when a load is replaced.
        if (error as NSError).code == NSURLErrorCancelled { return }

        promptForServer(
            reason: "Couldn't reach \(ServerConfig.currentString).\n\nCheck the address, or that the server is running."
        )
    }
}
