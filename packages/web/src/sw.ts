import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist, NetworkOnly } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

/** Caches serwist's defaultCache had been filling that we now bypass. */
const ORPHANED_CACHES = ['cross-origin', 'apis'];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /**
     * The API must never be routed through a caching strategy.
     *
     * The API lives on a DIFFERENT ORIGIN (fittrackr-api.geehive.com vs
     * fittrackr.geehive.com), and serwist's `defaultCache` ends with a
     * catch-all cross-origin rule using `NetworkFirst` with
     * `networkTimeoutSeconds: 10`. So every API GET was:
     *
     *  1. FAILING OUTRIGHT if it took longer than 10 seconds. NetworkFirst
     *     falls back to the cache on timeout, there is no cached entry for a
     *     one-off authenticated request, so the fetch rejects — surfacing as
     *     "Could not reach the server. Check your connection and try again."
     *     That is every AI call made over GET: the next-week plan and the
     *     whole of /coach. It only ever happened in a built/deployed app,
     *     because the service worker is disabled in development.
     *  2. CACHED FOR AN HOUR. Authenticated workout data was being written to
     *     the Cache API and could be served stale on the next load.
     *
     * Matching on the `/api/` pathname covers the cross-origin API and the
     * same-origin Next route handler alike. This MUST stay first —
     * `runtimeCaching` is ordered and the first matching rule wins — and rules
     * without an explicit `method` match GET only, which is all that needs
     * intercepting since non-GET requests are never routed.
     */
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// Drop what the old rules cached. Without this, responses to authenticated API
// requests stay in the Cache API on every device that ran a previous build.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all(ORPHANED_CACHES.map((name) => caches.delete(name))).then(() => undefined),
  );
});
