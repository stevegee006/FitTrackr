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

/**
 * `unavailable` is NOT the same as `invalid`, and conflating them cost a
 * debugging session: with the plugin unregistered this returned false, and the
 * UI said "that address was rejected" about a perfectly good URL. If the
 * bridge is missing the app needs rebuilding, which is a completely different
 * instruction to give someone.
 */
export type ServerSetResult = 'ok' | 'invalid' | 'unavailable';

export async function setServerUrl(url: string): Promise<ServerSetResult> {
  const bridge = plugins()?.ServerConfig as ServerConfigBridge | undefined;
  if (!bridge) return 'unavailable';
  try {
    const res = await bridge.set({ url });
    return res?.ok ? 'ok' : 'invalid';
  } catch { return 'invalid'; }
}

/** Back to the URL this build shipped with. */
export async function resetServerUrl(): Promise<ServerSetResult> {
  const bridge = plugins()?.ServerConfig as ServerConfigBridge | undefined;
  if (!bridge) return 'unavailable';
  try {
    const res = await bridge.reset();
    return res?.ok ? 'ok' : 'invalid';
  } catch { return 'invalid'; }
}

// ─── Apple Watch workout ─────────────────────────────────────────────────────

/**
 * Recording the session on the watch.
 *
 * This is what a phone-written HKWorkout cannot do: an `HKWorkoutSession` on
 * the wrist samples heart rate and derives active energy from it, so the
 * session earns real Move-ring credit. Writing a workout from the phone gets
 * it into Fitness with neither.
 *
 * The phone launches the watch app via `HKHealthStore.startWatchApp`, which is
 * the only way an iPhone can start one at all.
 */
interface WatchWorkoutBridge {
  status(): Promise<{ healthAvailable: boolean; paired: boolean; appInstalled: boolean }>;
  start(options: { workoutName: string }): Promise<{ started: boolean; reason?: string }>;
  stop(): Promise<{ stopped: boolean }>;
  summary(options: { startedAt: number }): Promise<{
    found: boolean; avgHeartRateBpm?: number; activeEnergyKcal?: number;
  }>;
  rest(options: {
    endsAt: number | null; exerciseName?: string; setNumber?: number; totalSets?: number;
  }): Promise<void>;
  pause(options: { paused: boolean }): Promise<void>;
  addListener(
    event: 'pauseChanged',
    cb: (data: { paused: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface WatchStatus {
  healthAvailable: boolean;
  paired: boolean;
  appInstalled: boolean;
}

export async function getWatchStatus(): Promise<WatchStatus | null> {
  try {
    return await (plugins()?.WatchWorkout as WatchWorkoutBridge | undefined)?.status() ?? null;
  } catch { return null; }
}

/**
 * Begin recording on the watch. Safe to call when there is no watch — every
 * failure resolves, because a missing watch must never interrupt the workout
 * being logged on the phone.
 */
export async function startWatchWorkout(workoutName: string): Promise<void> {
  try { await (plugins()?.WatchWorkout as WatchWorkoutBridge | undefined)?.start({ workoutName }); }
  catch { /* ignore */ }
}

/** Stop and SAVE on the watch. Queued if the watch is momentarily unreachable. */
export async function stopWatchWorkout(): Promise<void> {
  try { await (plugins()?.WatchWorkout as WatchWorkoutBridge | undefined)?.stop(); }
  catch { /* ignore */ }
}

/**
 * Mirror the rest countdown onto the watch.
 *
 * Driven by the same state as the Live Activity, from the same effect, for the
 * same reason: state rather than events means the wrist cannot get out of step
 * with the page, and a missed "rest ended" cannot leave a countdown running.
 *
 * Pass null to clear. Resolves regardless — no watch, asleep, or app not
 * installed must never disturb the workout being logged on the phone.
 */
export async function syncWatchRest(rest: WorkoutActivityState['rest']): Promise<void> {
  try {
    const bridge = plugins()?.WatchWorkout as WatchWorkoutBridge | undefined;
    if (!bridge) return;
    await bridge.rest(
      rest
        ? {
            endsAt: rest.endsAt,
            exerciseName: rest.exerciseName,
            setNumber: rest.setNumber,
            totalSets: rest.totalSets,
          }
        : { endsAt: null },
    );
  } catch { /* ignore */ }
}

/**
 * Pause or resume the watch session alongside the phone's clock.
 *
 * Not only cosmetic: a session left running keeps sampling heart rate and
 * accruing active energy through the break, so a paused workout that carries on
 * recording inflates the workout HealthKit saves — and the calories the
 * dashboard then reports.
 *
 * State rather than an event, driven from the same effect as everything else,
 * so a dropped message is corrected by the next one instead of leaving the two
 * clocks permanently out of step.
 */
export async function setWatchPaused(paused: boolean): Promise<void> {
  try {
    const bridge = plugins()?.WatchWorkout as WatchWorkoutBridge | undefined;
    if (!bridge) return;
    await bridge.pause({ paused });
  } catch { /* ignore */ }
}

/**
 * Listen for the session being paused or resumed ON THE WATCH.
 *
 * The watch reports; the page decides. The phone owns the clock — its elapsed
 * time is what gets written to the workout's duration — so letting the wrist
 * set it directly would give the value two owners.
 *
 * Returns a function that removes the listener, or null outside the native
 * shell so callers can `void remove?.()` without branching.
 */
export async function onWatchPauseChanged(
  cb: (paused: boolean) => void,
): Promise<(() => void) | null> {
  try {
    const bridge = plugins()?.WatchWorkout as WatchWorkoutBridge | undefined;
    if (!bridge?.addListener) return null;
    const handle = await bridge.addListener('pauseChanged', ({ paused }) => cb(paused));
    return () => { void handle.remove(); };
  } catch { return null; }
}

export interface WatchWorkoutSummary {
  avgHeartRateBpm: number | null;
  activeEnergyKcal: number | null;
}

/**
 * What the watch measured, read back out of HealthKit.
 *
 * Returns null when there is nothing yet, which is ORDINARY rather than an
 * error: the watch ending its session and the workout appearing in the phone's
 * HealthKit store are seconds apart, so the caller retries. Treating the first
 * empty answer as "no data" would lose the measurement on nearly every
 * session.
 *
 * `startedAt` is epoch milliseconds. The native side matches by time and
 * activity type, since the phone never learns the workout's identifier — the
 * watch owns the session and saves it on its own side.
 */
export async function getWatchWorkoutSummary(startedAt: number): Promise<WatchWorkoutSummary | null> {
  try {
    const bridge = plugins()?.WatchWorkout as WatchWorkoutBridge | undefined;
    if (!bridge) return null;
    const res = await bridge.summary({ startedAt });
    if (!res?.found) return null;
    return {
      avgHeartRateBpm: res.avgHeartRateBpm ?? null,
      activeEnergyKcal: res.activeEnergyKcal ?? null,
    };
  } catch { return null; }
}
