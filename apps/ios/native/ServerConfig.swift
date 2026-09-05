import Foundation

/**
 Which self-hosted FitTrackr this build points at.

 `server.url` in capacitor.config.ts is compiled into the bundle, so on its own
 it means a friend running their own instance would have to edit the config and
 rebuild. This makes it a runtime setting instead: the value is read from
 `UserDefaults` at launch and the compiled-in URL is only the default.

 The bridge is unaffected. `MainViewController` feeds this into the Capacitor
 instance descriptor's `serverURL` before the webview loads, so as far as
 Capacitor is concerned it is still an ordinary `server.url` — which is what
 keeps the plugins, and therefore the Live Activity, working.
 */
enum ServerConfig {
    private static let key = "fittrackr.serverURL"

    /// Falls back to whatever capacitor.config.ts shipped with.
    static var current: URL? {
        if let stored = UserDefaults.standard.string(forKey: key),
           let url = URL(string: stored) {
            return url
        }
        return compiledDefault
    }

    static var currentString: String {
        current?.absoluteString ?? ""
    }

    /// True when the user has chosen a host, as opposed to inheriting the default.
    static var isConfigured: Bool {
        UserDefaults.standard.string(forKey: key) != nil
    }

    /// The `server.url` baked into the bundled capacitor.config.json.
    static var compiledDefault: URL? {
        guard
            let path = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
            let data = try? Data(contentsOf: path),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let server = json["server"] as? [String: Any],
            let urlString = server["url"] as? String
        else { return nil }
        return URL(string: urlString)
    }

    /// Store a host. Returns the normalised URL, or nil when it is unusable.
    @discardableResult
    static func set(_ raw: String) -> URL? {
        guard let url = normalise(raw) else { return nil }
        UserDefaults.standard.set(url.absoluteString, forKey: key)
        return url
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    /**
     Accept what someone would actually type.

     "fit.example.com" becomes "https://fit.example.com"; a trailing slash is
     dropped so the value can be concatenated safely. **http is refused unless
     the host is a private-network address** — passkeys, service workers and
     `crypto.subtle` all require a secure context, so a plain-http host would
     produce a half-broken app that is very hard to diagnose from the symptoms.
     localhost and RFC1918 addresses are treated as secure by WebKit, so those
     are allowed through for anyone testing against a LAN box.
     */
    static func normalise(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "https://" + text
        }
        while text.hasSuffix("/") { text.removeLast() }

        guard let url = URL(string: text), let host = url.host, !host.isEmpty else { return nil }

        if url.scheme?.lowercased() == "http" && !isPrivateHost(host) {
            return nil
        }
        return url
    }

    private static func isPrivateHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h.hasSuffix(".local") || h == "127.0.0.1" || h == "::1" {
            return true
        }
        if h.hasPrefix("10.") || h.hasPrefix("192.168.") { return true }
        // 172.16.0.0 – 172.31.255.255
        if h.hasPrefix("172.") {
            let parts = h.split(separator: ".")
            if parts.count > 1, let second = Int(parts[1]), (16...31).contains(second) {
                return true
            }
        }
        return false
    }
}
