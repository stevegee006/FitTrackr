'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Timer, Pause, Play, RotateCcw } from 'lucide-react';

interface RestTimerProps {
  defaultSeconds?: number;
}

export function RestTimer({ defaultSeconds = 90 }: RestTimerProps) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (remaining === 0) setRemaining(seconds);
    setRunning(true);
  }, [remaining, seconds]);

  const reset = useCallback(() => {
    stop();
    setRemaining(seconds);
  }, [stop, seconds]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          stop();
          // PWA notification
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('FitTrackr', { body: 'Rest complete — time for your next set!', icon: '/icons/icon-192.png' });
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, stop]);

  const display = remaining > 0 ? remaining : seconds;
  const progress = remaining > 0 ? remaining / seconds : 0;
  const size = 72;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={remaining === 0 && running === false && display !== seconds ? '#10b981' : '#6366f1'}
            strokeWidth={stroke}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </g>
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          className="fill-current text-gray-700 dark:text-gray-200 font-semibold" fontSize={14}>
          {display}s
        </text>
      </svg>

      <div className="flex items-center gap-2">
        <button type="button" onClick={reset} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={running ? stop : start}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
            running
              ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 hover:bg-red-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Pause' : remaining > 0 ? 'Resume' : 'Start'}
        </button>
      </div>

      <div className="flex items-center gap-1">
        {[60, 90, 120, 180].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { stop(); setSeconds(s); setRemaining(s); }}
            className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
              seconds === s
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {s}s
          </button>
        ))}
      </div>
    </div>
  );
}
