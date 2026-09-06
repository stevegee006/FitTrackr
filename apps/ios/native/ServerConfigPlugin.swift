import Foundation
import Capacitor

/**
 Lets the web app read and change which server the shell points at, so the
 setting has a home in Profile → Settings as well as in the native first-run
 prompt.

 Exposed to JavaScript as `Capacitor.Plugins.ServerConfig`.

 Add this file to the APP target (not the widget).
 */
@objc(ServerConfigPlugin)
public class ServerConfigPlugin: CAPPlugin, CAPBridgedPlugin {

    // See the note in WorkoutActivityPlugin: Capacitor 7 registers through
    // this protocol, and the older .m-file macro fails silently.
    public let identifier = "ServerConfigPlugin"
    public let jsName = "ServerConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
    ]

    @objc func get(_ call: CAPPluginCall) {
        call.resolve([
            "url": ServerConfig.currentString,
            "isConfigured": ServerConfig.isConfigured,
            "default": ServerConfig.compiledDefault?.absoluteString ?? "",
        ])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = ServerConfig.set(raw) else {
            // Resolved rather than rejected so the web side can show its own
            // message without a thrown error crossing the bridge.
            return call.resolve(["ok": false, "reason": "invalid"])
        }

        DispatchQueue.main.async { [weak self] in
            // Reload onto the new host. See MainViewController.load for why the
            // bridge survives this, and why relaunching is the clean fallback.
            (self?.bridge?.viewController as? MainViewController)?
                .loadConfiguredServer()
        }
        call.resolve(["ok": true, "url": url.absoluteString])
    }

    /// Back to the URL this build shipped with.
    @objc func reset(_ call: CAPPluginCall) {
        ServerConfig.clear()
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? MainViewController)?
                .loadConfiguredServer()
        }
        call.resolve(["ok": true, "url": ServerConfig.currentString])
    }
}
