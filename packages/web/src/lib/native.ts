/**
 * Bridge to the native iOS shell, if one is hosting this page.
 *
 * Deliberately imports NOTHING. The shell loads the deployed site over https
 * rather than bundling it, so the same JavaScript runs in Safari, in the
 * installed PWA and inside the native webview — and Capacitor injects its
 * `window.Capacitor` global only in the last of those. Detecting the global
 * instead of importing `@capacitor/core` means:
 *
 *  - the web bundle gains no dependency and no bytes;
 *  - the PWA is completely unaffected, so it stays a working fallback;
 *  - there is no build-time coupling between the web app and the iOS project.
 *
 * Every call is a no-op that resolves when the bridge is absent, so callers do
 * not need to branch on the platform.
 */

interface RestTimerBridge {
  start(options: RestActivityState & { workoutName: string }): Promise<void>;
  update(options: RestActivityState): Promise<void>;
  end(): Promise<void>;
}

export interface RestActivityState {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  /** Epoch milliseconds. Swift turns this into the Date the widget counts to. */
  endsAt: number;
  startedAt: number;
}

function bridge(): RestTimerBridge | null {
  if (typeof window === 'undefined') return null;
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return (cap.Plugins?.RestTimer as RestTimerBridge) ?? null;
  } catch {
    return null;
  }
}

/** True inside the native shell. Use it for UI that only makes sense there. */
export function isNativeShell(): boolean {
  return bridge() !== null;
}

/**
 * Start or replace the Live Activity.
 *
 * Safe to call when one is already running — the plugin updates the existing
 * activity rather than stacking a second, which is why the exercise and set
 * live in the activity's mutable state rather than its static attributes.
 */
export async function startRestActivity(
  state: RestActivityState & { workoutName: string },
): Promise<void> {
  try { await bridge()?.start(state); } catch { /* never break the timer */ }
}

/** Push a new end time or set label into a running activity. */
export async function updateRestActivity(state: RestActivityState): Promise<void> {
  try { await bridge()?.update(state); } catch { /* ignore */ }
}

/** Dismiss the Live Activity. Safe when none is running. */
export async function endRestActivity(): Promise<void> {
  try { await bridge()?.end(); } catch { /* ignore */ }
}
