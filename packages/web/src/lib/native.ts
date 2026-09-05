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

/**
 * The whole session in one payload.
 *
 * There is a SINGLE Live Activity for the workout, not one per feature: iOS
 * shows one activity in the Dynamic Island at a time, so a session clock and a
 * rest countdown as separate activities would fight over it. The activity
 * changes phase instead — `rest` non-null means it is showing the countdown.
 */
export interface WorkoutActivityState {
  workoutId: string;
  workoutName: string;
  /** Wall-clock anchor the elapsed time counts up from, epoch ms. */
  startedAt: number;
  /** Epoch ms when the clock was paused; null while running. */
  pausedAt: number | null;
  setsDone: number;
  setsTotal: number;
  rest: {
    exerciseName: string;
    setNumber: number;
    totalSets: number;
    endsAt: number;
    startedAt: number;
  } | null;
}

interface WorkoutActivityBridge {
  sync(options: Record<string, unknown>): Promise<{ active: boolean }>;
  end(): Promise<void>;
}

interface ServerConfigBridge {
  get(): Promise<{ url: string; isConfigured: boolean; default: string }>;
  set(options: { url: string }): Promise<{ ok: boolean; url?: string }>;
  reset(): Promise<{ ok: boolean; url: string }>;
}

function plugins(): Record<string, any> | null {
  if (typeof window === 'undefined') return null;
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins ?? null;
  } catch {
    return null;
  }
}

/** True inside the native shell. Use it to hide UI that only works there. */
export function isNativeShell(): boolean {
  return plugins() !== null;
}

// ─── Live Activity ───────────────────────────────────────────────────────────

/**
 * Start or update the session Live Activity.
 *
 * One idempotent call for every state change — clock started, paused, resumed,
 * a set ticked, rest begun or finished. The native side starts an activity if
 * there is none and updates it otherwise, so nothing here has to track whether
 * one exists.
 *
 * The nested `rest` object is flattened because Capacitor's `getDouble`/
 * `getString` read top-level keys only.
 */
export async function syncWorkoutActivity(state: WorkoutActivityState): Promise<void> {
  try {
    const bridge = plugins()?.WorkoutActivity as WorkoutActivityBridge | undefined;
    if (!bridge) return;
    await bridge.sync({
      workoutId: state.workoutId,
      workoutName: state.workoutName,
      startedAt: state.startedAt,
      pausedAt: state.pausedAt ?? undefined,
      setsDone: state.setsDone,
      setsTotal: state.setsTotal,
      restExerciseName: state.rest?.exerciseName,
      restSetNumber: state.rest?.setNumber,
      restTotalSets: state.rest?.totalSets,
      restEndsAt: state.rest?.endsAt,
      restStartedAt: state.rest?.startedAt,
    });
  } catch { /* a Live Activity must never break the timer on screen */ }
}

/** Dismiss the activity. Safe when none is running. */
export async function endWorkoutActivity(): Promise<void> {
  try { await (plugins()?.WorkoutActivity as WorkoutActivityBridge | undefined)?.end(); }
  catch { /* ignore */ }
}

// ─── Server configuration ────────────────────────────────────────────────────

/**
 * Which self-hosted instance the shell points at.
 *
 * `server.url` is compiled into the bundle, so without this a friend running
 * their own FitTrackr would have to edit the config and rebuild. The native
 * side keeps the value in `UserDefaults` and feeds it to Capacitor before the
 * webview loads, so it is still an ordinary `server.url` and the plugins are
 * unaffected.
 */
export async function getServerConfig() {
  try {
    return await (plugins()?.ServerConfig as ServerConfigBridge | undefined)?.get() ?? null;
  } catch { return null; }
}

/** Returns false when the address was rejected. The app reloads on success. */
export async function setServerUrl(url: string): Promise<boolean> {
  try {
    const res = await (plugins()?.ServerConfig as ServerConfigBridge | undefined)?.set({ url });
    return res?.ok ?? false;
  } catch { return false; }
}

/** Back to the URL this build shipped with. */
export async function resetServerUrl(): Promise<boolean> {
  try {
    const res = await (plugins()?.ServerConfig as ServerConfigBridge | undefined)?.reset();
    return res?.ok ?? false;
  } catch { return false; }
}
