# FitTrackr — native iOS shell

A thin Capacitor app whose only reason to exist is the **session Live
Activity** on the Lock Screen and in the Dynamic Island — elapsed workout time,
sets done, and the rest countdown with its exercise and set. Everything else is
the existing web app: the shell loads the configured server directly rather
than bundling anything.

**One activity, not two.** iOS shows a single Live Activity in the Dynamic
Island at a time, so a session clock and a rest countdown as separate
activities would fight over it. This one starts with the workout clock, ends
when the workout is finished, and switches presentation while resting.

**The PWA is unaffected and remains the fallback.** There is no second
frontend to keep in step — deploy the web app as usual and this picks it up on
next launch.

## Why it loads the live site instead of bundling

Because the webview's origin is then the real https origin rather than
`capacitor://localhost`:

| | Bundled (`output: 'export'`) | Loads the live site |
|---|---|---|
| Passkeys | break — rpID is the hostname | work unchanged |
| CORS | needs a new allowed origin | works unchanged |
| `deriveApiUrl()` | breaks — hostname is `localhost` | works unchanged |
| `[id]` routes | need `generateStaticParams` | fine |
| Deploys | build and re-sign for every web change | pick up automatically |

The cost is that the shell needs the network at launch. The app already did —
the access token is memory-only and `AuthProvider` refreshes on mount before
anything renders — so nothing is lost that was not already gone.

## First-time setup

### On the Mac, before anything else

| Need | Check | Install |
|---|---|---|
| Xcode 15+ | `xcodebuild -version` | App Store, then **launch it once** to finish component install |
| Command line tools | `xcode-select -p` | `xcode-select --install` |
| CocoaPods | `pod --version` | `brew install cocoapods` |
| Node 20+ | `node -v` | `brew install node` |
| pnpm 10 | `pnpm -v` | `corepack enable && corepack prepare pnpm@10.30.1 --activate` |

`cap add ios` runs `pod install` under the hood, so **a missing CocoaPods is
the most common first failure** and its error is not obvious.

### Generate the project

```bash
git clone https://github.com/stevegee006/FitTrackr.git
cd FitTrackr
pnpm install                 # from the REPO ROOT — this is a pnpm workspace

cd apps/ios
pnpm cap:add                 # creates apps/ios/ios/
pnpm cap:open                # opens ios/App/App.xcworkspace
```

If `pnpm cap:add` dies on **`certificate verify failed (unable to get local
issuer certificate)`**, that is Ruby's CA bundle, not CocoaPods. The project
itself was created successfully — only the dependency fetch failed — so retry
just that step:

```bash
cd ios/App && SSL_CERT_FILE=/etc/ssl/cert.pem pod install
```

Prefix any later `pnpm cap:sync` the same way, since that runs `pod install`
again. Ordinary Xcode builds do not touch the spec index, so this only bites
when dependencies change.

**`--packagemanager SPM` does not avoid CocoaPods.** The flag exists and is
accepted, but the CLI runs its environment check before honouring it and still
refuses to continue without CocoaPods installed. Do not go down that path
expecting to skip the Ruby setup.

The scripts are `cap:add` / `cap:sync` / `cap:open`, **not** `add` / `sync` /
`open`: `pnpm add` and `pnpm install` are pnpm's own commands and would shadow
a script of that name, which fails with a confusing "missing package" error
rather than running anything.

`pnpm install` must be run from the repo root. Running it inside `apps/ios`
works too — pnpm finds the workspace — but the root is the habit that always
works.

### In Xcode

These are the GUI steps that cannot be scripted.

1. **Signing.** Select the **App** target → Signing & Capabilities → tick
   *Automatically manage signing* → Team: your personal Apple ID. If it is not
   listed, add it under Xcode → Settings → Accounts.

   If you see *"Failed to register bundle identifier"*, change the Bundle
   Identifier to something unique — e.g. `com.<yourname>.fittrackr`. Apple
   requires bundle IDs to be globally unique even for free provisioning.

2. **Create the widget extension.** File → New → Target → **Widget Extension**.
   Name it `FitTrackrWidget`, **tick "Include Live Activity"**, do NOT tick
   "Include Configuration App Intent". When Xcode offers to activate the new
   scheme, say **Cancel** — you want to keep building the app scheme, which
   embeds the widget automatically.

3. **Add the sources from `native/`.** Drag them into the Project Navigator,
   tick *Copy items if needed*, then set Target Membership in the File
   Inspector (right panel):

   | File | Target |
   |---|---|
   | `WorkoutActivityAttributes.swift` | **both** App and FitTrackrWidget |
   | `WorkoutLiveActivity.swift` | FitTrackrWidget only |
   | `WorkoutActivityPlugin.swift` | App only |
   | `ServerConfig.swift` | App only |
   | `ServerConfigPlugin.swift` | App only |
   | `MainViewController.swift` | App only |

   `WorkoutActivityAttributes.swift` being in only ONE target is the most
   common mistake — it surfaces as "cannot find type
   'WorkoutActivityAttributes'" in whichever target is missing it.

   **Untick "Copy items if needed."** With it ticked Xcode duplicates the files
   into `ios/App/`, and the copies are what get compiled — so edits to
   `native/` in the repo silently do nothing, and the two versions drift.
   Referencing them keeps one copy under version control.

4. **Replace the sample widget.** Xcode generated a `FitTrackrWidgetBundle`
   with placeholder widgets. Edit it so its `body` contains only
   `WorkoutLiveActivity()`, and delete the sample widget/attributes files it
   created — they define a second `ActivityAttributes` that will confuse you.

5. **Point the storyboard at `MainViewController`.** Open
   `App/Base.lproj/Main.storyboard`, select the Bridge View Controller scene,
   and in the Identity Inspector set Class to `MainViewController` (Module:
   App). Skipping this leaves the server fixed to the compiled-in URL.

6. **Enable Live Activities.** Select the **App** target → Info → add a row:

   | Key | Type | Value |
   |---|---|---|
   | `NSSupportsLiveActivities` | Boolean | `YES` |

### Onto the phone

1. Plug the iPhone in and trust the Mac.
2. **Enable Developer Mode on the phone**: Settings → Privacy & Security →
   Developer Mode → on, then restart. This is required on iOS 16+ and the
   option **does not appear until you have tried to install a build once**, so
   run from Xcode first, let it fail, then look.
3. In Xcode, pick your iPhone from the device dropdown (top bar) and press ▶.
4. First run fails with *"Untrusted Developer"*. On the phone: Settings →
   General → VPN & Device Management → your Apple ID → **Trust**. Run again.

With a free personal team the build stops launching after **7 days** — press ▶
again to reinstall. Your data is on the server, so nothing is lost.

No APNs, no push entitlement and no paid account are required — see below.

## Why this needs no push notifications

The widget uses SwiftUI's `Text(timerInterval:)` and
`ProgressView(timerInterval:)`, which **count down in the widget process
unaided**. The app hands over an end date once; the countdown then runs with no
further involvement, backgrounded or locked.

So every call from the app is a real change — a new end time from ±10s, or the
next set — never a tick. That is what keeps this inside the free tier and
avoids background execution entirely.

## Pointing it at a different server

`server.url` is compiled into the bundle, which would mean a friend running
their own FitTrackr had to edit the config and rebuild. Instead the URL is a
runtime setting:

- `ServerConfig` keeps it in `UserDefaults`, with the compiled-in URL as the
  default.
- `MainViewController.instanceDescriptor()` feeds it to Capacitor **before the
  webview loads**, so as far as Capacitor is concerned it is still an ordinary
  `server.url` — which is what keeps the plugins, and therefore the Live
  Activity, working.
- Change it from **Profile → Settings → Server** in the app, which renders only
  inside the shell.
- A **native prompt** appears on first launch when the build has no default,
  and whenever the configured host cannot be reached. That matters: a typo'd
  host means there is no web app left to render the settings screen, so the
  recovery path has to be native.

`http` is refused unless the host is localhost or a private-network address —
passkeys, service workers and `crypto.subtle` all need a secure context, and a
plain-http host produces a half-broken app that is very hard to diagnose from
the symptoms.

Signed-in sessions belong to a server, so switching means signing in again.

## Registering a plugin (Capacitor 7)

A plugin must conform to **`CAPBridgedPlugin`** and declare its own identity:

```swift
@objc(MyPlugin)
public class MyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MyPlugin"        // the ObjC class
    public let jsName = "My"                   // what JavaScript looks up
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "doThing", returnType: CAPPluginReturnPromise),
    ]
}
```

The older approach — a `CAP_PLUGIN` macro in a companion `.m` file — does not
register anything on its own in Capacitor 7, and **fails silently**: the app
builds, runs, and `Capacitor.Plugins` simply lacks the plugin. There is no
error in Xcode and none in the JS console.

**Conformance is necessary but NOT sufficient.** Capacitor 6+ stopped
discovering plugins by scanning the Objective-C runtime; it instantiates the
classes named in `packageClassList` in the generated
`ios/App/App/capacitor.config.json`, and the CLI builds that list from
installed **npm packages**. A plugin living in the app is never in it.

So app-local plugins must be registered by hand, in `MainViewController`:

```swift
override open func capacitorDidLoad() {
    bridge?.registerPluginInstance(WorkoutActivityPlugin())
    bridge?.registerPluginInstance(ServerConfigPlugin())
}
```

That hook survives `cap sync`; editing the generated config file would not.
**Anything added to `native/` from now on needs a line here**, or it will look
correct and do nothing.

The check that actually answers it, in Safari's inspector attached to the app:

```js
Object.keys(Capacitor.Plugins)
```

A stock project lists `CapacitorHttp`, `Console`, `WebView`, `CapacitorCookies`.
Ours should add `WorkoutActivity` and `ServerConfig`.

## How the web side talks to it

`packages/web/src/lib/native.ts` detects Capacitor's injected
`window.Capacitor` global instead of importing `@capacitor/core`. The web
bundle therefore gains **no dependency and no bytes**, and every call is a
no-op that resolves when the bridge is absent — which is the case in Safari and
in the PWA.

The logger owns the activity through a **single effect driven by state**,
rather than calls scattered through the start/pause/finish handlers — so it
cannot drift out of step with what the page is showing, because it is
recomputed from the same values the page renders from. `RestTimerModal` reports
its countdown upward rather than talking to the bridge itself; two callers
writing to one activity would race.

`elapsed` is deliberately not a dependency of that effect: it changes every
second and the widget counts on its own, so only real changes cross the bridge
— pausing, resuming, a set ticked, rest starting or ending.

## When it goes wrong

| Symptom | Cause |
|---|---|
| `pnpm add` prints pnpm usage / "missing package" | The scripts are `cap:add`, `cap:sync`, `cap:open` — bare `add` collides with pnpm's own command |
| `cap add ios` → "pod: command not found" | CocoaPods missing: `brew install cocoapods` |
| `cap add ios` → "certificate verify failed" | Ruby's CA bundle. Re-run `pod install` with `SSL_CERT_FILE=/etc/ssl/cert.pem`, or drop off a TLS-inspecting VPN |
| `brew install` → "Command Line Tools are too outdated" | `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, or reinstall the CLT |
| `gem install cocoapods` → "ffi requires Ruby >= 3.0" | macOS system Ruby is 2.6. Use Homebrew's CocoaPods rather than pinning old gems |
| `cap add ios` → cannot read `capacitor.config.ts` | `typescript` not installed — run `pnpm install` from the repo root first |
| "Cannot find type 'WorkoutActivityAttributes'" | That file is in only one target; it needs **both** |
| `Capacitor.Plugins.WorkoutActivity` is undefined in JS | The plugin is not conforming to `CAPBridgedPlugin`, or its file is not in the App target. **This fails silently** — the app builds and runs. Check with `Object.keys(Capacitor.Plugins)` in Safari's inspector |
| App loads but no Live Activity | `NSSupportsLiveActivities` missing, or Live Activities off in Settings → FitTrackr |
| Dynamic Island shows nothing, Lock Screen fine | Not an iPhone 14 Pro or later — expected |
| Server never changes from the default | The storyboard still points at `CAPBridgeViewController` |
| "Untrusted Developer" on launch | Settings → General → VPN & Device Management → Trust |
| Device missing from Xcode's dropdown | Developer Mode not enabled on the phone |

## The Apple Watch app

The watch app exists for one reason: **only an `HKWorkoutSession` running on
the wrist samples heart rate and derives active energy from it.** A workout
written from the phone appears in Fitness with neither, and so earns no honest
Move-ring credit. This is what replaces starting the workout on the watch by
hand.

`HKHealthStore.startWatchApp(with:)` is the only way an iPhone can start a
watch app — there is no general launch API. It hands over an
`HKWorkoutConfiguration` that arrives in the watch app's
`WKApplicationDelegate.handle(_:)`, which begins recording. Everything after
that goes over WatchConnectivity.

Stop uses `transferUserInfo`, not `sendMessage`: the latter needs the watch
reachable at that instant, and a stop that silently fails leaves a session
running on the wrist until the system kills it — losing the whole workout.

### Adding the watch target

1. File → New → Target → **App** under watchOS. Name it `FitTrackrWatch`,
   and when asked, attach it to the existing **App** target so it installs
   alongside the phone app.
2. Add the four files from `native/watch/` to the **watch** target only:
   `WorkoutManager.swift`, `WatchConnector.swift`, `FitTrackrWatchApp.swift`,
   `WatchWorkoutView.swift`. Delete the `ContentView.swift` Xcode generates.
3. Add `PhoneWatchConnector.swift` and `WatchWorkoutPlugin.swift` from
   `native/` to the **App** target.
4. **Watch target → Signing & Capabilities → + Capability → HealthKit.**
5. **Watch target → Info**, add:

   | Key | Type | Value |
   |---|---|---|
   | `NSHealthShareUsageDescription` | String | Reads heart rate to record your workout. |
   | `NSHealthUpdateUsageDescription` | String | Saves your workout to Health. |
   | `WKBackgroundModes` | Array → String | `workout-processing` |

   `workout-processing` is not optional — without it the session is suspended
   when the screen sleeps and stops collecting.
6. The **App** target needs the same two usage strings, plus the HealthKit
   capability it already has.

### Testing it

**Device only.** HealthKit workout sessions do not work usefully in the
simulator, so this needs the iPhone provisioned and a paired Watch.

## Known limits

- Dynamic Island: iPhone 14 Pro and later. Others get the Lock Screen only.
- Live Activities cap at 8 hours and end themselves.
- A free personal team expires builds after 7 days.
- **The iOS CSS sharp edges still apply** (handoff #56 `backdrop-filter` on
  fixed elements, #57 safe-area insets). This is still WKWebView — the shell
  buys the timer, not a layout fix.
- Starting an activity requires the app to be in the foreground on iOS 16.x.
  The activity starts with the workout clock, which is a deliberate tap, so
  this is not a problem in practice.

## Obvious next steps

- **Notifications when rest ends.** `RestTimer` already calls
  `new Notification(...)` but nothing ever requests permission (handoff #41),
  so it is dead code today. A native local notification scheduled for the end
  date would work while the phone is locked.
- **Widget actions.** iOS 17 allows buttons in a Live Activity — "skip rest" or
  "+30s" without unlocking. Requires `AppIntent` in the widget target.
