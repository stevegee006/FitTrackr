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
2. **Delete both files Xcode generates** — `ContentView.swift` and its
   `FitTrackrWatchApp.swift`. The generated app file declares `@main`, and so
   does ours; two in one target is a hard error, and because the names match
   it reads like a phantom duplicate rather than a collision.
3. Add the four files from `native/watch/` to the **watch** target only:
   `WorkoutManager.swift`, `WatchConnector.swift`, `FitTrackrWatchApp.swift`,
   `WatchWorkoutView.swift`, `SharedRest.swift`. Say **no** to the Objective-C
   bridging header
   Xcode offers — the target is pure Swift, and a stale
   `SWIFT_OBJC_BRIDGING_HEADER` has already cost this project an hour once.
4. Add `PhoneWatchConnector.swift` and `WatchWorkoutPlugin.swift` to the
   **App** target.
5. **App target → General → Minimum Deployments → iOS 17.0.** Capacitor
   scaffolds the App target at iOS 14, and the phone-side HealthKit calls
   need 15+: `requestAuthorization(toShare:read:)` and the
   `HKQuantityType(.heartRate)` shorthand both fail to compile below it. The
   app already cannot run under 16.1 anyway, since Live Activities need it —
   the 14.0 floor was enforcing support the app never actually had.
6. **Watch target → Signing & Capabilities → + Capability → HealthKit.**
7. **Watch target → Info**, add:

   | Key | Type | Value |
   |---|---|---|
   | `NSHealthShareUsageDescription` | String | Reads heart rate to record your workout. |
   | `NSHealthUpdateUsageDescription` | String | Saves your workout to Health. |
   | `WKBackgroundModes` | Array → String | `workout-processing` |

   `workout-processing` is not optional — without it the session is suspended
   when the screen sleeps and stops collecting.
8. The **App** target needs the same two usage strings, plus the HealthKit
   capability it already has.

### Keeping the sources in sync

Xcode copied these files rather than referencing them, so **the repo is not
what compiles**. Both paths need copying before a build, or an edit lands
nowhere and the compiler quietly builds yesterday:

```
cd apps/ios   && cp native/*.swift ios/App/   && cp native/*.swift ios/App/App/   && cp native/watch/*.swift "ios/App/FitTrackrWatch Watch App/"   && cp native/complication/*.swift native/watch/SharedRest.swift        ios/App/FitTrackrWatchComplication/   && npx cap sync ios
```

`SharedRest.swift` lands in two target folders on purpose. Xcode's
synchronized folder groups map one file to one target, so sharing it means
either a fragile cross-group reference or a second copy — and both copies come
from the same `native/watch/SharedRest.swift`, so this keeps them identical by
construction.

Yes, four destinations. `ios/App/` and `ios/App/App/` both accumulated
copies, and the project references the OUTER ones — which is how a plugin
registered in `native/MainViewController.swift` stayed missing from
`Capacitor.Plugins` after a rebuild that reported success.

The tell that you have hit this: an error whose path starts `ios/App/...`
naming a line you just fixed in `native/`, or a change that simply does not
take.

### The app icon

```
sh apps/ios/scripts/install-icons.sh
```

Installs `icon/AppIcon-1024.png` into both asset catalogues. Run it after
regenerating the Xcode project, since `apps/ios/ios` is gitignored and the
catalogues go with it.

The source is full-bleed and has no alpha on purpose — iOS applies its own
squircle mask, so an icon carrying its own rounded corners shows black
wedges past the mask, and alpha is rejected outright at validation.

A single 1024 for both platforms; Xcode derives the rest. A full sixteen-size
watchOS set was tried and reverted — it was meant to fix the grey placeholder
in the ongoing-session indicator at the top of the watch face and did not.
That indicator is not reading our asset: the icon is already correct in the
app grid, in Fitness and on the iPhone. The likeliest explanation is that a
development-signed app never reaches that surface, and there is nothing in the
project to change. Do not spend another afternoon on it.

### Importing workouts recorded elsewhere

Anything in HealthKit that FitTrackr did not write — the watch's own Workout
app, Fitbod, Strava — is imported automatically, once per app launch, by
`useHealthImport` in the dashboard layout.

**The source filter is load-bearing, not tidiness.** FitTrackr's own sessions
are in HealthKit too, so without skipping anything whose source bundle id
starts with ours, every logged workout would come back as a duplicate of
itself.

**A rolling 90-day window, not an `HKAnchoredObjectQuery`.** An anchor is more
efficient and much less safe: it advances when read, so an upload that failed
would lose those workouts permanently and silently. Re-sending costs a few
kilobytes, and the server upserts on the HKWorkout UUID, so it is idempotent by
construction.

Two consequences worth knowing:

- **Deletions do not propagate.** A workout deleted in Health stays in
  FitTrackr. Deliberate — silently deleting a logged workout because a sync
  said so is worse than a stale row someone can remove themselves.
- **An existing import is not overwritten wholesale.** Renaming an imported
  walk, or changing its type, survives the next launch; only the measurements
  refresh, since HealthKit is authoritative for those.

Imported workouts **count as workout days** for the weekly frequency ring and
the streak. They cannot be separated: the streak is defined as weeks that met
the frequency goal, so counting them for one and not the other would have the
ring say a week was missed while the streak said it was met. Per-muscle volume
targets are unaffected either way — those count sets, and an import has none.

### When rest ends

**The Live Activity reverts on its own.** The countdown runs in JavaScript, and
iOS suspends the webview when the phone locks — which is exactly when rest is
running and the phone is in a pocket. Nothing arrived to say rest was over, so
the activity sat at 0:00, hiding the session clock behind a stopped timer.

The fix is `staleDate`: the plugin sets it to the finish line, the system
re-renders at that instant with `context.isStale`, and the views fall back to
`ContentState.withoutRest()`. No push, no background execution, nothing of ours
running.

**The phone always alerts, and so does the watch.** An earlier version
suppressed the phone's notification while a wrist session was recording, to
avoid a double buzz. That was reversed: the phone only ever knew that
`startWatchApp` had succeeded, not that the watch was still on an arm — so
leaving the watch on a bench meant no alert from either device. A duplicate
buzz is a mild annoyance; a missed rest is the feature not working.

`RestAlerts` schedules a local notification for the finish line, and a
`UNUserNotificationCenterDelegate` makes it present even with the app on
screen — iOS suppresses a local notification for its own foregrounded app
otherwise, and mid-set the phone is often awake but not being looked at. Sound
routes to whatever is playing, AirPods included, and a
`UINotificationFeedbackGenerator` covers a phone on silent — but only the
haptic half. See the chime below for the audible one.

The web app's own `Notification` call is skipped in the native shell, since it
would be a third alert for the same rest.

**The chime is played by the app, not by the notification.** The ring/silent
switch suppresses every notification sound unconditionally — there is no flag
that overrides it short of Apple's Critical Alerts entitlement, which needs
their approval — so a phone that lives on silent got a banner and nothing else.
`RestAudio` uses an `AVAudioSession` set to `.playback`, which ignores the
switch by design.

Ducking is raised around the chime and lowered again, NOT set once for the
session. `.duckOthers` applies for as long as the session is active, and this
session is active for the whole workout — so setting it at the start dimmed
music the moment the clock started and kept it dimmed for an hour. The
keep-alive runs `.mixWithOthers` only.

Playing audio needs the app to be RUNNING, and iOS suspends it seconds after
the phone locks. So a one-second file of silence is looped for the length of
the workout, which is what Background Audio keeps an app alive for. It is a
well-worn trick, and the only way to make a sound happen at a chosen instant on
a locked phone without a server pushing it.

The cost is real: a workout holds an audio session open, so there is a battery
penalty for as long as the clock runs. The session is released the moment the
workout is finished.

**Setup:** add `RestAudio.swift`, `rest-chime.wav` and `silence.wav` to the
**App** target, and tick **Signing & Capabilities → + Capability → Background
Modes → Audio**. Without that capability the app is suspended on lock and the
chime never fires — silently, since everything else still works.

Notification permission is requested lazily, on the first rest timer rather
than at launch: a prompt before the user has done anything gets denied
reflexively, and a denied prompt cannot be shown again.

### Controls on the watch

**Pause, and the three rest controls** — Skip, +10s, −10s, which appear only
while resting. Each one ASKS the phone rather than changing anything locally:
the web app owns the finish line that the Live Activity, the complication and
the watch all render, so a wrist that moved its own copy would disagree with
all three within a second. The buttons are therefore honest about latency — the
countdown moves when the phone answers.

Start and End were both there and both lied:
"Start here" began a wrist session with no FitTrackr workout behind it, and
"End" stopped the wrist while the phone carried on counting. Pause survived
because the watch can report it back, so the two devices stay in step.

The cost is that only the phone can end a session. If it dies mid-workout the
wrist runs until watchOS reclaims it, never reaching `finishWorkout()`, and
saves nothing. Accepted deliberately: two controls that misrepresented what
they did were worse than one missing escape hatch.

### Pause

Pausing on the phone pauses the wrist session too. That is not cosmetic: a
session left running keeps sampling heart rate and accruing active energy
through the break, so the workout HealthKit saves comes out longer and hotter
than the one that happened — and the dashboard's calorie ring inherits it.

`setPaused` on the watch issues **commands only**; the published state is
updated by `HKWorkoutSessionDelegate`. That is what makes pausing from the
watch's own system card — watchOS shows one in the Smart Stack, with a pause
button — behave identically to pausing from the phone. Two writers would give
a UI that disagrees with the session it describes.

`isRunning` stays **true while paused**. It means "in a session", not "not
paused" — the view uses it to choose between the workout UI and the idle
prompt, and a paused workout must not render as no workout.

The counting text is anchored to `timerAnchor`, not `startedAt`: on resume the
anchor moves to `now - builder.elapsedTime`, which already discounts the
paused stretch. `startedAt` stays the real beginning, which is what HealthKit
records. While paused the view shows a frozen string instead —
`Text(timerInterval:)` would keep ticking, which is the bug this exists to fix.

### The rest countdown

While a rest timer runs on the phone, the watch shows it full-screen instead of
the stats. Pushed by `syncWatchRest`, driven by the same state and the same
effect as the Live Activity — two owners could disagree about whether rest is
running, and the wrist is the surface you would not notice was wrong.

Sent as an **absolute end instant**, never a remaining duration. That is what
lets `Text(timerInterval:)` count down on its own, and it stays correct across
a screen sleep or a message that spent time queued to a sleeping watch. A
remaining-seconds value would be wrong by however long it was in flight.

`endsAt: null` means rest is over — skipped, or the next set ticked. Sent as
the same message rather than a separate clear, so a lost clear cannot leave a
countdown running.

`SharedRest` mirrors the state into the **App Group**
(`group.com.geehive.fittrackr`), because a complication is a separate process
and cannot see `WorkoutManager`. Both surfaces read one store, so they cannot
disagree. Add the App Groups capability with that container to every target
that reads it — it does provision on a free personal team, contrary to
expectation.

### The Live Activity on the watch face

watchOS surfaces iPhone Live Activities at the top of the watch face — but
**only if the activity opts in**. Without `.supplementalActivityFamilies([.small])`
on the `ActivityConfiguration`, the system substitutes a generic grey
placeholder instead of your views. It still opens the app when tapped, which is
what makes it look like a missing app icon rather than a missing opt-in; the
watch app icon and the iPhone app icon are both fine and neither is involved.

`LockScreenView` branches on `@Environment(\.activityFamily)` and draws a much
tighter layout for `.small` — the Lock Screen design is several times too wide
for a watch face slot.

Requires the widget extension's **Minimum Deployment to be iOS 18.0 or later**;
`supplementalActivityFamilies` does not exist below it.

### The rest-timer complication

A watch face complication showing the same countdown. Optional — the watch app
already shows it, and this is for glancing at the face rather than opening the
app.

**Adding the target:**

1. File → New → Target → **Widget Extension** under watchOS. Name it
   `FitTrackrWatchComplication`. **Untick "Include Live Activity"** and
   **untick "Include Configuration App Intent"** — this is a static
   complication with nothing to configure.
2. When asked to embed, embed it in **FitTrackrWatch Watch App**, not the
   iPhone app.
3. Delete the generated `FitTrackrWatchComplication.swift` — like the watch
   app template, it declares its own `@main`, and two in one target is a hard
   error.
4. Add `native/complication/RestComplication.swift` **and**
   `native/watch/SharedRest.swift` to the complication target.
   `SharedRest.swift` belongs to both targets: it is the shared contract, and
   the whole point is that one store is read by both.
5. **Signing & Capabilities → + Capability → App Groups**, tick
   `group.com.geehive.fittrackr`. Without it the extension reads an empty
   store and the complication is permanently idle — with no error anywhere.

**Why the timeline holds one entry.** WidgetKit will not wake an extension
every second, and a timeline of ninety one-second entries would spend the whole
refresh budget on a single rest. `ProgressView(timerInterval:)` and
`Text(timerInterval:)` animate themselves once rendered, so the entry is
static and the reload policy is simply `.after(endsAt)` — the complication
clears itself and asks for nothing in between.

Nothing polls. The watch app calls `WidgetCenter.reloadAllTimelines()` when
rest starts and ends, which it can do freely because it is already awake
holding the workout session. That is also why
`transferCurrentComplicationUserInfo` and its ~50/day budget are not involved:
a 20-set session would exhaust it, and there is no need.

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
