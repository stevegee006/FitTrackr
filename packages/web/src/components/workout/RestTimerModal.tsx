'use client';

import { Card } from '@/components/ui/Card';
import { SkipForward, ChevronDown } from 'lucide-react';
import { REST_PRESETS } from '@/lib/rest';
import { useRestTimer, useRestTick } from '@/providers/RestTimerProvider';

/**
 * The full-screen rest countdown.
 *
 * PRESENTATION ONLY. It owns no clock and no state: the countdown, the
 * end-of-rest alert and the Apple Watch subscription all live in
 * `RestTimerProvider`, because they have to keep running when this is not on
 * screen. Minimising it must not cancel a rest, which is exactly what used to
 * happen when the timer owned its own `endAt`.
 */
export function RestTimerModal() {
  const { rest, total, adjust, choosePreset, stop, minimize } = useRestTimer();
  const { remaining, done } = useRestTick();

  if (!rest) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(secs);

  const size = 148;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // Clamped: pressing −10s near the end floors `remaining` at the minimum,
  // which can briefly exceed `total` and would otherwise invert the arc.
  const progress = total > 0 ? Math.min(1, remaining / total) : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-sm space-y-5">
        <div className="flex items-center">
          {/* Minimise. The rest keeps running as a floating pill, so this is a
              way to go and look at something else mid-rest rather than a
              disguised cancel — Skip is the cancel. */}
          <button
            type="button"
            onClick={minimize}
            className="p-1.5 -m-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
            title="Minimise"
            aria-label="Minimise rest timer"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <p className="flex-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {done ? 'Rest complete' : 'Rest'}
          </p>
          {/* Balances the minimise button so the label stays centred. */}
          <span className="w-4" aria-hidden />
        </div>

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
            onClick={stop}
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
          {REST_PRESETS.map((s) => (
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
