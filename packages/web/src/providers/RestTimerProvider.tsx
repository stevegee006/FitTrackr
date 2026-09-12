'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { onWatchRestCommand, syncWatchRest, isNativeShell } from '@/lib/native';
import {
  getStoredRestSeconds, setStoredRestSeconds, REST_MIN_SECONDS as MIN_SECONDS,
  type RestActivity, type RestContext,
} from '@/lib/rest';

/** The workout the dock offers to take you back to. */
export interface ActiveSession {
  workoutId: string;
  name: string;
  /** Wall-clock origin: elapsed = (Date.now() - anchor) / 1000, while running. */
  anchor: number;
  running: boolean;
  /**
   * Elapsed seconds frozen at the moment of the pause.
   *
   * Needed because the anchor is NOT moved when the clock pauses — it is
   * recomputed on resume instead — so `Date.now() - anchor` keeps climbing
   * through a pause and would show a paused session still counting.
   */
  pausedElapsed: number;
}

interface RestTimerValue {
  /** The live countdown, in the shape the Live Activity and the watch want. */
  rest: RestActivity | null;
  /** The full span of the current rest, for the progress ring. */
  total: number;
  /** Whole seconds left. 0 once it has run out. */
  remaining: number;
  done: boolean;
  /** Full-screen, versus the floating pill. */
  expanded: boolean;
  session: ActiveSession | null;

  start: (opts: { context?: RestContext; exerciseId?: string | null; seconds?: number | null }) => void;
  adjust: (delta: number) => void;
  choosePreset: (seconds: number) => void;
  stop: () => void;
  minimize: () => void;
  expand: () => void;
  setSession: (session: ActiveSession | null) => void;
}

const RestTimerContext = createContext<RestTimerValue | null>(null);

export function useRestTimer(): RestTimerValue {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error('useRestTimer must be used inside RestTimerProvider');
  return ctx;
}

/**
 * Owns the rest countdown for the whole app.
 *
 * **Why this is a provider and not state on the workout page.** The countdown
 * has to outlive the page. Tapping away from the modal — to check the calendar,
 * to look something up — used to unmount the timer and silently cancel the
 * rest, so the only safe thing to do during a rest was stare at it. Mounted in
 * the dashboard layout, the rest survives navigation and shows as a floating
 * pill on whatever screen you land on.
 *
 * It owns the TICKING as well as the value, and that is the load-bearing part:
 * the end-of-rest alert has to fire whether or not anything is on screen, so
 * the interval, the completion handling and the Apple Watch subscription all
 * live here rather than in the modal. The modal is presentation only.
 *
 * Anchored to a wall-clock `endsAt` rather than decrementing a counter:
 * background tabs and locked phones throttle `setInterval`, so a decrementing
 * timer drifts badly. Same reason the workout clock uses an anchor.
 */
export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const [rest, setRest] = useState<RestActivity | null>(null);
  const [total, setTotal] = useState(90);
  const [remaining, setRemaining] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);

  const firedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors for the stable callbacks below, which must not capture a render.
  const totalRef = useRef(total);
  totalRef.current = total;
  const exerciseIdRef = useRef(exerciseId);
  exerciseIdRef.current = exerciseId;
  /**
   * The duration the athlete deliberately chose this rest, or null if they
   * simply let it run. Flushed once when the rest ends — ±10s is often tapped
   * three times in a row, and one PATCH per tap would be three requests.
   */
  const chosenRef = useRef<number | null>(null);

  const saveRestSeconds = useMutation({
    mutationFn: ({ id, restSeconds }: { id: string; restSeconds: number }) =>
      apiFetch(`/exercises/${id}/preference`, {
        method: 'PATCH',
        body: JSON.stringify({ restSeconds }),
      }),
  });

  /** Remember the duration against the exercise it was used for. */
  const flushDuration = useCallback(() => {
    const seconds = chosenRef.current;
    const id = exerciseIdRef.current;
    chosenRef.current = null;
    if (seconds == null || !id) return;

    saveRestSeconds.mutate({ id, restSeconds: seconds });
    // Patch every cached preference map rather than invalidating: a refetch
    // mid-session re-runs the logger's cardio-mode effect for no visible gain.
    queryClient.setQueriesData<Record<string, any>>({ queryKey: ['exercise-prefs'] }, (old) =>
      old ? { ...old, [id]: { ...(old[id] ?? {}), restSeconds: seconds } } : old,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const stop = useCallback(() => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
    flushDuration();
    firedRef.current = false;
    setRest(null);
    setExpanded(false);
    setExerciseId(null);
    setRemaining(0);
  }, [flushDuration]);

  const start = useCallback<RestTimerValue['start']>(({ context, exerciseId: eid, seconds }) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
    firedRef.current = false;
    chosenRef.current = null;

    // The exercise's remembered rest, then the global fallback. A brand-new
    // exercise has no preference, and the duration the athlete generally uses
    // beats a hardcoded 90.
    const span = seconds ?? getStoredRestSeconds();
    const now = Date.now();

    totalRef.current = span;
    setTotal(span);
    setRemaining(span);
    setExerciseId(eid ?? null);
    setExpanded(true);
    setRest({
      exerciseName: context?.exerciseName ?? 'Rest',
      setNumber: context?.setNumber ?? 0,
      totalSets: context?.totalSets ?? 0,
      endsAt: now + span * 1000,
      startedAt: now,
    });
  }, []);

  /** Shift the finish line, and the ring's span with it. */
  const adjust = useCallback((delta: number) => {
    if (firedRef.current) return; // already finished; don't resurrect it
    const next = Math.max(MIN_SECONDS, totalRef.current + delta);
    totalRef.current = next;
    setTotal(next);
    // ±10s is a judgement about this exercise, not a one-off nudge — the next
    // set of the same movement wants the same rest.
    chosenRef.current = next;
    setRest((prev) =>
      prev
        ? { ...prev, endsAt: Math.max(Date.now() + MIN_SECONDS * 1000, prev.endsAt + delta * 1000) }
        : prev,
    );
  }, []);

  const choosePreset = useCallback((seconds: number) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
    firedRef.current = false;

    // Both: the global value is the fallback for exercises with no preference
    // of their own, and `chosenRef` remembers it against THIS exercise.
    setStoredRestSeconds(seconds);
    totalRef.current = seconds;
    chosenRef.current = seconds;
    setTotal(seconds);
    setRest((prev) => (prev ? { ...prev, endsAt: Date.now() + seconds * 1000 } : prev));
  }, []);

  const minimize = useCallback(() => setExpanded(false), []);
  const expand = useCallback(() => setExpanded(true), []);

  /**
   * The countdown itself, and what happens when it runs out.
   *
   * Runs on `rest`, not on `expanded` — a minimized rest still has to finish,
   * alert and clear itself.
   */
  useEffect(() => {
    if (!rest) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000));
      setRemaining(left);

      if (left === 0 && !firedRef.current) {
        firedRef.current = true;
        // Permission is never requested anywhere, so this is a no-op unless the
        // user granted it out of band. Guarded so it can't throw either way.
        //
        // Skipped entirely in the native shell: iOS schedules a local
        // notification for the finish line, which fires even with the phone
        // locked. Both would alert twice for one rest.
        try {
          if (!isNativeShell() && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('FitTrackr', {
              body: 'Rest complete — time for your next set!',
              icon: '/icons/icon-192.png',
            });
          }
        } catch { /* ignore */ }
        // Leave "Rest complete" on screen briefly rather than vanishing.
        closeTimeoutRef.current = setTimeout(() => stop(), 1200);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [rest, stop]);

  useEffect(() => () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

  /**
   * The wrist gets the countdown from HERE, not from the workout page.
   *
   * The page's own sync effect unmounts the moment you navigate away, so a
   * rest skipped from the dock on another screen left the watch counting down
   * a rest that no longer existed. This provider outlives every page, which
   * makes it the only place that can own the wrist countdown.
   *
   * Still ONE owner of this call, which is the rule that mattered: the Live
   * Activity is a different sink, fed from this same `rest` object by the page
   * that owns the activity as a whole.
   */
  useEffect(() => {
    void syncWatchRest(rest);
  }, [rest]);

  /**
   * Skip and ±10s from the Apple Watch.
   *
   * Subscribed once for the lifetime of the app rather than per rest, so the
   * refs are what keep it current. The handlers are the very same ones the
   * on-screen buttons call, so the wrist cannot drift into a second code path
   * with its own clamping rules.
   */
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const adjustRef = useRef(adjust);
  adjustRef.current = adjust;
  const restingRef = useRef(false);
  restingRef.current = rest != null;

  useEffect(() => {
    let remove: (() => void) | null = null;
    let cancelled = false;

    void onWatchRestCommand((command, delta) => {
      // A command that arrives with no rest running would otherwise start one
      // from nothing, or adjust a finish line that does not exist.
      if (!restingRef.current) return;
      if (command === 'skip') stopRef.current();
      else adjustRef.current(delta);
    }).then((fn) => {
      if (cancelled) fn?.();
      else remove = fn;
    });

    return () => { cancelled = true; remove?.(); };
  }, []);

  const value = useMemo<RestTimerValue>(() => ({
    rest,
    total,
    remaining,
    done: rest != null && remaining === 0,
    expanded,
    session,
    start,
    adjust,
    choosePreset,
    stop,
    minimize,
    expand,
    setSession,
  }), [rest, total, remaining, expanded, session, start, adjust, choosePreset, stop, minimize, expand]);

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}
