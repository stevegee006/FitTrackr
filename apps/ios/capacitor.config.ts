import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The shell does NOT bundle the web app — it loads the deployed site.
 *
 * That is the whole reason this is cheap. Because the webview's origin is the
 * real https origin rather than `capacitor://localhost`:
 *
 *  - passkeys keep working (rpID is the hostname — sharp edge #4);
 *  - CORS keeps working (config/cors.ts matches on the frontend domain — #6);
 *  - `deriveApiUrl()`'s hostname heuristic still resolves;
 *  - Next stays on `output: 'standalone'`; no static export, and no
 *    `generateStaticParams` for the `[id]` routes.
 *
 * It also means the native app picks up every web deploy on next launch, and
 * the PWA remains a fully working fallback rather than a second thing to keep
 * in step.
 *
 * The trade is that the shell needs the network at launch. The app already
 * does — the access token is memory-only and AuthProvider refreshes on mount
 * before anything renders — so nothing is lost that was not already gone.
 *
 * `webDir` still has to point somewhere; ./www holds a placeholder that is only
 * ever seen if `server.url` is unreachable.
 */
const config: CapacitorConfig = {
  appId: 'com.geehive.fittrackr',
  appName: 'FitTrackr',
  webDir: 'www',
  server: {
    /**
     * DELIBERATELY no `url`.
     *
     * The host is a runtime setting — `MainViewController.instanceDescriptor()`
     * reads it from UserDefaults at launch, and the first-run prompt asks for
     * it. Baking one in made every build carry the author's instance, so a
     * friend installing it landed on someone else's server staring at a login
     * for an account they do not have. Shipping no default means the app has
     * to ask, which is the correct behaviour for something self-hosted.
     *
     * With no url, Capacitor falls back to `webDir` until a host is chosen —
     * ./www is a "no server configured" placeholder, never the app.
     */
    cleartext: false,
    /**
     * Required for switching hosts without a relaunch — without it the webview
     * refuses to navigate away from the origin it started on. The bridge script
     * is injected as a WKUserScript at document start, so plugins survive the
     * move.
     */
    allowNavigation: ['*'],
  },
  ios: {
    // Matches the app's own dark chrome rather than flashing white on launch.
    backgroundColor: '#030712',
    // The web app owns its safe-area insets already (`pt-safe*` utilities and
    // the status-bar scrim — #57), so the webview must not inset it a second
    // time or everything gains a double margin.
    contentInset: 'never',
  },
};

export default config;
