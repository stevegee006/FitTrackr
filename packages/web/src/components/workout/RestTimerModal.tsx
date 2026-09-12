'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { onWatchRestCommand, isNativeShell } from '@/lib/native';
import { Card } from '@/components/ui/Card';
import { SkipForward } from 'lucide-react';

const STORAGE_KEY = 'fittrackr_rest_seconds';
const PRESETS = [60, 90, 120, 180];
const MIN_SECONDS = 5;

/**
 * The global fallback, kept in localStorage.
 *
 * Still here now that rest is remembered per exercise: a brand-new exercise
 * has no preference, and starting it at the duration the athlete generally
 * uses beats starting it at a hardcoded 90.
 */
export function getStoredRestSeconds(fallback = 90): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return Number.isNaN(v) ? fallback : v;
  } catch {
    return fallback;
  }
}

export interface RestContext {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
}

export interface RestActivity extends RestContext {
  endsAt: number;
  startedAt: number;
}

interface RestTimerModalProps {
  onClose: () => void;
  /**
   * What the athlete just finished. Only used to label the iOS Live Activity —
   * the modal itself does not display it, because the exercise card it opens
   * over already says all of this.
   */
  context?: RestContext;
  /**
   * Reports the live countdown upward so the page can fold it into the single
   * session Live Activity. Called with null when the timer goes away.
   *
   * The modal does not talk to the native bridge itself: there is ONE activity
   * for the whole session and the page owns it, so two callers writing to it
   * would race.
   */
  onRestActivityChange?: (rest: RestActivity | null) => void;
  /**
   * The remembered rest for the exercise that just finished, if it has one.
   * Null falls back to the global localStorage value.
   */
  initialSeconds?: number | null;
  /**
   * The athlete deliberately changed the duration — a preset, or ±10s. Reports
   * the new total so the page can remember it against the exercise.
   *
   * Not called for the countdown simply running down: that is not a choice.
   */
  onDurationChange?: (seconds: number) => void;
}

/**
 * Rest countdown shown as a popup when a working set is completed.
 *
 * Anchored to a wall-clock `endAt` rather than decrementing a counter:
 * background tabs and locked phones throttle `setInterval`, so a decrementing
 * timer drifts badly. The same reason the workout clock uses an anchor.
 */
export function RestTimerModal({
  onClose,
  context,
  onRestActivityChange,
  initialSeconds,
  onDurationChange,
}: RestTimerModalProps) {
  // Read ONCE, in a lazy initialiser. The modal is remounted by key on every
  // open, so there is no case where a prop change should restart a running
  // countdown — and reacting to one would reset the clock mid-rest if the
  // preference query happened to refetch.
  const [total, setTotal] = useState(() => initialSeconds ?? getStoredRestSeconds());
  const [endAt, setEndAt] = useState(() => Date.now() + (initialSeconds ?? getStoredRestSeconds()) * 1000);
  const [remaining, setRemaining] = useState(() => initialSeconds ?? getStoredRestSeconds());
  const onDurationChangeRef = useRef(onDurationChange);
  onDurationChangeRef.current = onDurationChange;
  // Mirrors `total` for the callbacks below, which are stable by design.
  const totalRef = useRef(total);
  totalRef.current = total;
  const firedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(Date.now());
  // Read through a ref in the unmount cleanup: capturing the prop directly
  // would pin the first render's callback, and an empty dep array is required
  // so the cleanup runs on unmount rather than on every prop identity change.
  const onRestActivityChangeRef = useRef(onRestActivityChange);
  onRestActivityChangeRef.current = onRestActivityChange;
  // The watch listener is registered once and outlives every render, so it
  // must not capture a particular render's `adjust` or `onClose`.
  const adjustRef = useRef<(delta: number) => void>(() => {});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

  /**
   * Report the countdown upward for the iOS Live Activity.
   *
   * `endAt` is the single source of truth on both sides: the widget is handed
   * the end date and counts down by itself, so ±10s and the presets only push
   * a new date rather than streaming updates.
   */
  useEffect(() => {
    if (!context || !onRestActivityChange) return;
    onRestActivityChange({ ...context, endsAt: endAt, startedAt: startedAtRef.current });
  }, [context, endAt, onRestActivityChange]);

  // Clear it on unmount, however the modal closed — finished, skipped, or the
  // page navigated away. A rest countdown outliving its timer is worse than
  // not having one.
  useEffect(() => () => { onRestActivityChangeRef.current?.(null); }, []);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
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
        closeTimeoutRef.current = setTimeout(onClose, 1200);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endAt, onClose]);

  /** Shift the finish line, and the ring's span with it. */
  const adjust = useCallback((delta: number) => {
    if (firedRef.current) return; // already finished; don't resurrect it
    setEndAt((prev) => Math.max(Date.now() + MIN_SECONDS * 1000, prev + delta * 1000));
    // Through a ref rather than a setState updater: reporting upward is a side
    // effect, and an updater can be invoked more than once per commit.
    // Writing the ref immediately also keeps two quick taps additive.
    const next = Math.max(MIN_SECONDS, totalRef.current + delta);
    totalRef.current = next;
    setTotal(next);
    // ±10s is a judgement about this exercise, not a one-off nudge — the next
    // set of the same movement wants the same rest.
    onDurationChangeRef.current?.(next);
  }, []);
  adjustRef.current = adjust;

  /**
   * Skip and +/-10s from the Apple Watch.
   *
   * Subscribed HERE rather than on the page because this component owns the
   * finish line — routing it through a parent would mean lifting `endAt` into
   * the page purely to let the watch reach it.
   *
   * `adjust` and `onClose` are the very same functions the on-screen buttons
   * call, so the wrist cannot drift into a second code path with its own
   * clamping rules.
   */
  useEffect(() => {
    let remove: (() => void) | null = null;
    let cancelled = false;

    void onWatchRestCommand((command, delta) => {
      if (command === 'skip') onCloseRef.current();
      else adjustRef.current(delta);
    }).then((fn) => {
      if (cancelled) fn?.();
      else remove = fn;
    });

    return () => { cancelled = true; remove?.(); };
  }, []);

  const choosePreset = useCallback((s: number) => {
    firedRef.current = false;
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    // Both: the global value is the fallback for exercises with no preference
    // of their own, and the callback remembers it against THIS exercise.
    try { localStorage.setItem(STORAGE_KEY, String(s)); } catch { /* ignore */ }
    totalRef.current = s;
    setTotal(s);
    setEndAt(Date.now() + s * 1000);
    onDurationChangeRef.current?.(s);
  }, []);

  const done = remaining === 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(secs);

  const size = 148;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // Clamped: pressing −10s near the end floors `remaining` at MIN_SECONDS,
  // which can briefly exceed `total` and would otherwise invert the arc.
  const progress = total > 0 ? Math.min(1, remaining / total) : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-sm space-y-5">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {done ? 'Rest complete' : 'Rest'}
        </p>

        <div className="flex justify-center">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="currentColor"
                className="text-gray-200 dark:text-gray-700"
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={done ? '#10b981' : '#6366f1'}
                strokeWidth={stroke}
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - progress)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 250ms linear' }}
              />
            </g>
            <text
              x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
              className="fill-current font-bold text-gray-900 dark:text-white"
              fontSize={40}
            >
              {label}
            </text>
          </svg>
        </div>

        {/* −10s · Skip · +10s */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjust(-10)}
            disabled={done}
            className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            −10s
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            <SkipForward className="h-4 w-4" />
            Skip
          </button>
          <button
            type="button"
            onClick={() => adjust(10)}
            disabled={done}
            className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            +10s
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => choosePreset(s)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                total === s
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {s >= 120 ? `${s / 60}min` : `${s}s`}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
