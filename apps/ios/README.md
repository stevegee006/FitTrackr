# FitTrackr — native iOS shell

A thin Capacitor app whose only reason to exist is the **rest-timer Live
Activity** on the Lock Screen and in the Dynamic Island. Everything else is the
existing web app: the shell loads `https://fittrackr.geehive.com` directly
rather than bundling anything.

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
   Name it `RestTimerWidget`, **tick "Include Live Activity"**, and do NOT tick
   "Include Configuration Intent". Xcode adds the target's Info.plist keys for
   you.

3. **Add the sources from `native/`:**

   | File | Target |
   |---|---|
   | `RestTimerAttributes.swift` | **both** App and RestTimerWidget |
   | `RestTimerLiveActivity.swift` | RestTimerWidget only |
   | `RestTimerPlugin.swift` | App only |
   | `RestTimerPlugin.m` | App only |

   Drag them into the project and set Target Membership in the File Inspector.
   `RestTimerAttributes.swift` being in only one target is the most common
   mistake — it surfaces as "cannot find type 'RestTimerAttributes'" in
   whichever target is missing it.

   In the generated widget bundle, replace the sample widget with
   `RestTimerLiveActivity()`.

4. **Enable Live Activities in the app target's Info.plist:**

   ```xml
   <key>NSSupportsLiveActivities</key>
   <true/>
   ```

5. Build and run to the device.

No APNs, no push entitlement and no paid account are required — see below.

## Why this needs no push notifications

The widget uses SwiftUI's `Text(timerInterval:)` and
`ProgressView(timerInterval:)`, which **count down in the widget process
unaided**. The app hands over an end date once; the countdown then runs with no
further involvement, backgrounded or locked.

So every call from the app is a real change — a new end time from ±10s, or the
next set — never a tick. That is what keeps this inside the free tier and
avoids background execution entirely.

## How the web side talks to it

`packages/web/src/lib/native.ts` detects Capacitor's injected
`window.Capacitor` global instead of importing `@capacitor/core`. The web
bundle therefore gains **no dependency and no bytes**, and every call is a
no-op that resolves when the bridge is absent — which is the case in Safari and
in the PWA.

`RestTimerModal` owns the countdown and drives the activity: it starts one on
mount, pushes a new end date whenever ±10s or a preset changes it, and ends it
on unmount however the modal closed. A Live Activity outliving its timer is
worse than not having one.

## Known limits

- Dynamic Island: iPhone 14 Pro and later. Others get the Lock Screen only.
- Live Activities cap at 8 hours and end themselves.
- A free personal team expires builds after 7 days.
- **The iOS CSS sharp edges still apply** (handoff #56 `backdrop-filter` on
  fixed elements, #57 safe-area insets). This is still WKWebView — the shell
  buys the timer, not a layout fix.
- Starting an activity requires the app to be in the foreground on iOS 16.x.
  Rest starts when a set is ticked, so this is not a problem in practice.

## Obvious next step

The **workout clock** is the same shape with a different end date, and it
already survives backgrounding via a wall-clock anchor in `localStorage`. A
session-long Live Activity is largely this code again with
`ProgressView(timerInterval:)` swapped for elapsed time.
