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
   | `WorkoutActivityPlugin.swift` + `.m` | App only |
   | `ServerConfig.swift` | App only |
   | `ServerConfigPlugin.swift` + `.m` | App only |
   | `MainViewController.swift` | App only |

   `WorkoutActivityAttributes.swift` being in only ONE target is the most
   common mistake — it surfaces as "cannot find type
   'WorkoutActivityAttributes'" in whichever target is missing it.

   If Xcode asks about an Objective-C bridging header when you add the `.m`
   files, say **yes** and leave the generated header empty.

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
| `cap add ios` → cannot read `capacitor.config.ts` | `typescript` not installed — run `pnpm install` from the repo root first |
| "Cannot find type 'WorkoutActivityAttributes'" | That file is in only one target; it needs **both** |
| `Capacitor.Plugins.WorkoutActivity` is undefined in JS | The matching `.m` file is missing from the App target — Capacitor finds plugins through the Objective-C runtime |
| App loads but no Live Activity | `NSSupportsLiveActivities` missing, or Live Activities off in Settings → FitTrackr |
| Dynamic Island shows nothing, Lock Screen fine | Not an iPhone 14 Pro or later — expected |
| Server never changes from the default | The storyboard still points at `CAPBridgeViewController` |
| "Untrusted Developer" on launch | Settings → General → VPN & Device Management → Trust |
| Device missing from Xcode's dropdown | Developer Mode not enabled on the phone |

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
