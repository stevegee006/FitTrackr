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

Requires macOS with Xcode 15+, and an iPhone on **iOS 16.1+** (Dynamic Island
needs iPhone 14 Pro or later; everything else gets the Lock Screen
presentation from the same code).

```bash
cd apps/ios
pnpm install
pnpm add            # npx cap add ios — generates the ios/ project
pnpm open           # opens ios/App/App.xcworkspace
```

Then, in Xcode — these are the GUI steps that cannot be scripted:

1. **Signing.** Select the `App` target → Signing & Capabilities → tick
   *Automatically manage signing* → pick your personal team. A free personal
   team is fine; builds expire after 7 days and are re-installed by running
   again.

2. **Create the widget extension.** File → New → Target → **Widget Extension**.
   Name it `FitTrackrWidget`, **tick "Include Live Activity"**, and do NOT tick
   "Include Configuration Intent". Xcode adds the target's Info.plist keys for
   you.

3. **Add the sources from `native/`:**

   | File | Target |
   |---|---|
   | `WorkoutActivityAttributes.swift` | **both** App and FitTrackrWidget |
   | `WorkoutLiveActivity.swift` | FitTrackrWidget only |
   | `WorkoutActivityPlugin.swift` + `.m` | App only |
   | `ServerConfig.swift` | App only |
   | `ServerConfigPlugin.swift` + `.m` | App only |
   | `MainViewController.swift` | App only |

   Drag them into the project and set Target Membership in the File Inspector.
   `WorkoutActivityAttributes.swift` being in only one target is the most
   common mistake — it surfaces as "cannot find type
   'WorkoutActivityAttributes'" in whichever target is missing it.

   In the generated widget bundle, replace the sample widget with
   `WorkoutLiveActivity()`.

4. **Point the storyboard at `MainViewController`.** Open
   `App/Base.lproj/Main.storyboard`, select the Bridge View Controller scene,
   and in the Identity Inspector change its class from `CAPBridgeViewController`
   to `MainViewController` (module: App). Without this the server stays fixed
   to whatever `capacitor.config.ts` shipped with.

5. **Enable Live Activities in the app target's Info.plist:**

   ```xml
   <key>NSSupportsLiveActivities</key>
   <true/>
   ```

6. Build and run to the device.

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
