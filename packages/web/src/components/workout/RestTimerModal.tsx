'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { SkipForward } from 'lucide-react';
import { startRestActivity, endRestActivity } from '@/lib/native';

const STORAGE_KEY = 'fittrackr_rest_seconds';
const PRESETS = [60, 90, 120, 180];
const MIN_SECONDS = 5;

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
  workoutName: string;
}

interface RestTimerModalProps {
  onClose: () => void;
  /**
   * What the athlete just finished. Only used to label the iOS Live Activity —
   * the modal itself does not display it, because the exercise card it opens
   * over already says all of this.
   */
  context?: RestContext;
}

/**
 * Rest countdown shown as a popup when a working set is completed.
 *
 * Anchored to a wall-clock `endAt` rather than decrementing a counter:
 * background tabs and locked phones throttle `setInterval`, so a decrementing
 * timer drifts badly. The same reason the workout clock uses an anchor.
 */
export function RestTimerModal({ onClose, context }: RestTimerModalProps) {
  const [total, setTotal] = useState(() => getStoredRestSeconds());
  const [endAt, setEndAt] = useState(() => Date.now() + getStoredRestSeconds() * 1000);
  const [remaining, setRemaining] = useState(() => getStoredRestSeconds());
  const firedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(Date.now());

  useEffect(() => () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

  /**
   * Mirror the countdown into an iOS Live Activity. No-ops everywhere else.
   *
   * `endAt` is the single source of truth on both sides: the widget is handed
   * the end date and counts down by itself, so ±10s and the presets only need
   * to push a new date rather than stream updates. Nothing here can throw —
   * the bridge swallows its own errors — so the timer behaves identically if
   * the native side is missing or broken.
   */
  useEffect(() => {
    if (!context) return;
    const state = {
      exerciseName: context.exerciseName,
      setNumber: context.setNumber,
      totalSets: context.totalSets,
      endsAt: endAt,
      startedAt: startedAtRef.current,
    };
    void startRestActivity({ ...state, workoutName: context.workoutName });
  }, [context, endAt]);

  // End it on unmount, however the modal closed — finished, skipped, or the
  // page navigated away. A Live Activity outliving its timer is worse than not
  // having one.
  useEffect(() => () => { void endRestActivity(); }, []);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(left);

      if (left === 0 && !firedRef.current) {
        firedRef.current = true;
        // Permission is never requested anywhere, so this is a no-op unless the
        // user granted it out of band. Guarded so it can't throw either way.
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
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
    setTotal((t) => Math.max(MIN_SECONDS, t + delta));
  }, []);

  const choosePreset = useCallback((s: number) => {
    firedRef.current = false;
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    try { localStorage.setItem(STORAGE_KEY, String(s)); } catch { /* ignore */ }
    setTotal(s);
    setEndAt(Date.now() + s * 1000);
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
