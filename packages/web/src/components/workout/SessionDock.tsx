'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SkipForward, Timer, Dumbbell } from 'lucide-react';
import { RestTimerModal } from '@/components/workout/RestTimerModal';
import { useRestTimer, useRestTick } from '@/providers/RestTimerProvider';

function clock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The rest countdown and the running session, on every screen.
 *
 * Mounted once in the dashboard layout so both survive navigation. Two states,
 * in priority order:
 *
 * - a rest is running → the countdown, expanded as the modal or collapsed to a
 *   pill with Skip on it;
 * - otherwise a session is open → a pill showing the workout clock, which is
 *   the "at least let me see the current session" half of this.
 *
 * The session pill is hidden on the session's OWN page, where the header
 * already shows the same clock. The rest pill is not: minimising the timer
 * there has to leave something to tap.
 */
export function SessionDock() {
  const { rest, expanded, session, expand, stop } = useRestTimer();
  const { remaining, done } = useRestTick();
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());

  // Only ticks for the session pill. The rest countdown has its own tick in
  // the provider, which runs whether or not this is mounted.
  const showSessionPill =
    !rest && session != null && pathname !== `/workouts/${session.workoutId}`;

  useEffect(() => {
    if (!showSessionPill || !session?.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showSessionPill, session?.running]);

  if (rest && expanded) return <RestTimerModal />;

  if (rest) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;

    return (
      <div className="fixed inset-x-0 z-[150] px-4 pointer-events-none bottom-24 lg:bottom-6">
        <div className="mx-auto max-w-lg lg:max-w-md pointer-events-auto">
          <div
            className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 shadow-lg border backdrop-blur transition-colors ${
              done
                ? 'bg-emerald-600/95 border-emerald-500 text-white'
                : 'bg-indigo-600/95 border-indigo-500 text-white'
            }`}
          >
            <button
              type="button"
              onClick={expand}
              className="flex flex-1 items-center gap-3 min-w-0 text-left"
            >
              <Timer className="h-5 w-5 shrink-0" />
              <span className="tabular-nums text-lg font-bold shrink-0" style={{ minWidth: '3.2rem' }}>
                {done ? 'Done' : label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs opacity-90">
                {rest.exerciseName}
                {rest.totalSets > 0 && ` · set ${rest.setNumber}/${rest.totalSets}`}
              </span>
            </button>
            <button
              type="button"
              onClick={stop}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showSessionPill || !session) return null;

  const elapsed = session.running
    ? Math.max(0, Math.floor((now - session.anchor) / 1000))
    : Math.max(0, session.pausedElapsed);

  return (
    <div className="fixed inset-x-0 z-[150] px-4 pointer-events-none bottom-24 lg:bottom-6">
      <div className="mx-auto max-w-lg lg:max-w-md pointer-events-auto">
        <Link
          href={`/workouts/${session.workoutId}`}
          className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-3 py-2.5 shadow-lg backdrop-blur active:scale-[0.99] transition-transform"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {session.running && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping" />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <Dumbbell className="h-4 w-4 shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{session.name}</span>
          <span className="shrink-0 tabular-nums text-sm font-bold text-indigo-600 dark:text-indigo-400">
            {clock(elapsed)}
          </span>
          {!session.running && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Paused
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
