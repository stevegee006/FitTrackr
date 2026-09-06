'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { DurationEditModal } from '@/components/workout/DurationEditModal';
import { CelebrationBurst, consumeCelebrate } from '@/components/workout/CelebrationBurst';
import { ChevronLeft, Trophy, TrendingUp, TrendingDown, Minus, Sparkles, Pencil, Heart, Flame } from 'lucide-react';
import { WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import { formatDuration } from '@/lib/utils';
import { CoachReviewCard, type CoachReview } from '@/components/coach/CoachReviewCard';
import { getWatchWorkoutSummary } from '@/lib/native';

const LB_PER_KG = 2.20462;

interface Tally {
  sets: number;
  totalReps: number;
  volumeKg: number;
  topWeightKg: number | null;
  bestSet: { reps: number; weightKg: number } | null;
  durationSec: number;
  distanceM: number;
}

interface SummaryExercise {
  exerciseId: string;
  name: string;
  primaryMuscle: string | null;
  current: Tally;
  previous: Tally | null;
  previousDate: string | null;
  delta: {
    sets: number; totalReps: number; volumeKg: number; topWeightKg: number | null;
    durationSec: number; distanceM: number;
  } | null;
  isFirstTime: boolean;
}

interface WorkoutSummary {
  workout: {
    id: string;
    name: string | null;
    workoutType: keyof typeof WORKOUT_TYPE_LABELS;
    logDate: string;
    durationMin: number | null;
    /** Absent on an older API. */
    completedAt?: string | null;
    /** NULL means never measured — no watch — not a burn of zero. */
    avgHeartRateBpm?: number | null;
    activeEnergyKcal?: number | null;
  };
  totals: {
    exercises: number; sets: number; totalReps: number; volumeKg: number;
    durationSec: number; distanceM: number; warmupSets: number;
    /** Logged but never ticked, so not counted. Absent on an older API. */
    skippedSets?: number;
  };
  exercises: SummaryExercise[];
  personalRecords: Array<{
    exerciseId: string;
    exerciseName: string;
    recordType: 'MAX_WEIGHT' | 'MAX_REPS' | 'MAX_1RM';
    value: number;
  }>;
}

const PR_LABEL: Record<string, string> = {
  MAX_WEIGHT: 'Heaviest weight',
  MAX_REPS: 'Most reps',
  MAX_1RM: 'Best estimated 1RM',
};

export default function WorkoutSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [editDuration, setEditDuration] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  // Read once on mount; the flag is cleared as it's read so a reload is quiet.
  useEffect(() => { if (consumeCelebrate(id)) setCelebrate(true); }, [id]);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });
  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const unit = isImperial ? 'lbs' : 'kg';

  const { data, isLoading, error } = useQuery({
    queryKey: ['workout-summary', id],
    queryFn: () => apiFetch<{ data: WorkoutSummary }>(`/workouts/${id}/summary`),
  });

  // MUST stay above the `if (isLoading) return` guards below. A hook declared
  // after an early return runs conditionally and throws React error #310,
  // which took every workout detail page down in production once (#77).
  const [coachStarted, setCoachStarted] = useState(false);

  const queryClient = useQueryClient();
  /**
   * Pull heart rate and calories out of HealthKit and store them.
   *
   * Runs here rather than on Finish because the numbers do not exist yet at
   * that moment: the watch has to end its session and HealthKit has to save
   * the workout first. Hence the retries — an empty first answer is normal,
   * not a signal that there is nothing to find.
   *
   * Gated on `avgHeartRateBpm == null` so it happens once and never again:
   * revisiting an old recap must not re-query, and a workout that genuinely
   * had no watch must not retry forever on every visit. `askedRef` stops
   * React's double-mount in development running it twice.
   */
  const askedRef = useRef(false);
  const summaryWorkout = data?.data?.workout;
  useEffect(() => {
    if (!summaryWorkout || askedRef.current) return;
    if (summaryWorkout.avgHeartRateBpm != null || summaryWorkout.activeEnergyKcal != null) return;
    // Only a finished session has anything to look for.
    if (!summaryWorkout.completedAt) return;
    askedRef.current = true;

    const endedAt = new Date(summaryWorkout.completedAt).getTime();
    if (!Number.isFinite(endedAt)) return;
    // Reconstructed, because the recap never knew the start instant. The
    // native side sorts newest-first and filters to this app's activity type,
    // so a generous floor costs nothing while a tight one risks missing a
    // session whose clock disagreed slightly with the watch's.
    const startedAt = summaryWorkout.durationMin != null
      ? endedAt - summaryWorkout.durationMin * 60_000
      : endedAt - 4 * 60 * 60_000;

    let cancelled = false;
    (async () => {
      // HealthKit is seconds behind the watch. Six tries over ~30s covers it
      // without leaving a timer running behind a screen nobody is looking at.
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        const found = await getWatchWorkoutSummary(startedAt);
        if (found && (found.avgHeartRateBpm != null || found.activeEnergyKcal != null)) {
          if (cancelled) return;
          try {
            await apiFetch(`/workouts/${id}/health`, {
              method: 'PATCH',
              body: JSON.stringify(found),
            });
            if (!cancelled) {
              queryClient.invalidateQueries({ queryKey: ['workout-summary', id] });
              queryClient.invalidateQueries({ queryKey: ['workout-volume'] });
            }
          } catch { /* the recap is still worth showing without it */ }
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryWorkout?.id, summaryWorkout?.completedAt]);

  // What the next fetch should do. A ref, not query state, so refetch() reads
  // the intent at call time and a remount cannot replay a refresh and re-spend
  // a credit. A bare GET is "show me what you have" and costs nothing, so a
  // review generated last week appears on load rather than hiding behind a
  // button that was already pressed.
  const coachMode = useRef<'peek' | 'generate' | 'refresh'>('peek');

  const sessionReview = useQuery({
    queryKey: ['session-review', id],
    queryFn: () => {
      const mode = coachMode.current;
      coachMode.current = 'peek';
      const q = mode === 'generate' ? '?generate=1' : mode === 'refresh' ? '?refresh=1' : '';
      return apiFetch<{ data: { model: string; review: CoachReview } | null; cached: boolean }>(
        `/coach/session-review/${id}${q}`, { timeout: 120_000 },
      );
    },
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });

  const sessionReviewData = sessionReview.data?.data ?? null;

  /** kg is canonical in storage; imperial is display-only. */
  const w = (kg: number) => {
    const v = isImperial ? kg * LB_PER_KG : kg;
    return Math.round(v * 10) / 10;
  };
  const vol = (kg: number) => Math.round(isImperial ? kg * LB_PER_KG : kg).toLocaleString();

  /** m/s → the user's distance unit. */
  const dist = (m: number) => {
    const v = isImperial ? m / 1609.344 : m / 1000;
    return `${Math.round(v * 100) / 100} ${isImperial ? 'mi' : 'km'}`;
  };
  const clock = (sec: number) => {
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return ss > 0 ? `${m}m ${ss}s` : `${m}m`;
    return `${ss}s`;
  };

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error || !data) {
    return (
      <Card className="py-8 text-center space-y-3">
        <p className="font-semibold">Couldn&apos;t load the summary</p>
        <Link href="/workouts" className="text-sm text-indigo-600 hover:underline">Back to workouts</Link>
      </Card>
    );
  }

  const s = data.data;
  const title = s.workout.name ?? WORKOUT_TYPE_LABELS[s.workout.workoutType] ?? 'Workout';
  const date = new Date(s.workout.logDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-4">
      {celebrate && <CelebrationBurst onDone={() => setCelebrate(false)} />}

      <div className="flex items-center gap-3">
        {/* Back to wherever you came from — the weekly recap, the workouts
            list, or the session itself — rather than always the list. Finish
            uses router.replace, so the finished workout is not left in the
            history and Back still lands somewhere sensible. Falls back to the
            list when there is no history to go back to, e.g. a deep link or a
            fresh tab, where back() would leave the app entirely. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/workouts');
          }}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{title} — Summary</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {date}
            {formatDuration(s.workout.durationMin) && ` · ${formatDuration(s.workout.durationMin)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditDuration(true)}
          className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Edit duration"
          aria-label="Edit workout duration"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      {editDuration && (
        <DurationEditModal
          workoutId={id}
          currentMin={s.workout.durationMin}
          onClose={() => setEditDuration(false)}
        />
      )}

      {/* Session totals */}
      <Card>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Exercises', value: String(s.totals.exercises) },
            { label: 'Sets', value: String(s.totals.sets) },
            { label: 'Reps', value: String(s.totals.totalReps) },
            { label: `Volume (${unit})`, value: vol(s.totals.volumeKg) },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{t.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}</p>
            </div>
          ))}
        </div>
        {/* Only when the watch actually measured it. A zero here would read as
            a genuinely feeble session rather than as "no watch". */}
        {(s.workout.avgHeartRateBpm != null || s.workout.activeEnergyKcal != null) && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-6">
            {s.workout.avgHeartRateBpm != null && (
              <div className="flex items-center gap-1.5">
                <Heart className="h-4 w-4 text-rose-500" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {s.workout.avgHeartRateBpm}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  avg bpm
                </span>
              </div>
            )}
            {s.workout.activeEnergyKcal != null && (
              <div className="flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {s.workout.activeEnergyKcal}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  kcal
                </span>
              </div>
            )}
          </div>
        )}
        {(s.totals.durationSec > 0 || s.totals.distanceM > 0) && (
          <p className="mt-3 text-center text-xs text-gray-600 dark:text-gray-300">
            {s.totals.durationSec > 0 && `${clock(s.totals.durationSec)} of timed work`}
            {s.totals.durationSec > 0 && s.totals.distanceM > 0 && ' · '}
            {s.totals.distanceM > 0 && `${dist(s.totals.distanceM)} covered`}
          </p>
        )}
        {s.totals.warmupSets > 0 && (
          <p className="mt-3 text-center text-[11px] text-gray-400 dark:text-gray-500">
            Plus {s.totals.warmupSets} warmup {s.totals.warmupSets === 1 ? 'set' : 'sets'} (not counted)
          </p>
        )}
        {/* Says why the recap shows fewer sets than the logger does. Without
            this the difference looks like lost data rather than unticked
            prefill from the last-session replay. */}
        {(s.totals.skippedSets ?? 0) > 0 && (
          <p className="mt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
            {s.totals.skippedSets} {s.totals.skippedSets === 1 ? 'set was' : 'sets were'} left
            unchecked and {s.totals.skippedSets === 1 ? 'is' : 'are'} not counted
          </p>
        )}
      </Card>

      {/* Personal records */}
      {s.personalRecords.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              {s.personalRecords.length} personal {s.personalRecords.length === 1 ? 'record' : 'records'}
            </p>
          </div>
          <ul className="space-y-1">
            {s.personalRecords.map((pr, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-amber-900 dark:text-amber-200 truncate">
                  {pr.exerciseName}
                  <span className="text-amber-700/70 dark:text-amber-400/70"> · {PR_LABEL[pr.recordType]}</span>
                </span>
                <span className="font-semibold text-amber-900 dark:text-amber-200 shrink-0">
                  {pr.recordType === 'MAX_REPS' ? `${pr.value} reps` : `${w(pr.value)} ${unit}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Per-exercise comparison */}
      {s.exercises.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">No working sets were logged.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Compared with last time
          </p>
          {s.exercises.map((ex) => (
            <Card key={ex.exerciseId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold truncate">{ex.name}</p>
                {ex.isFirstTime && (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <Sparkles className="h-3 w-3" />
                    First time
                  </span>
                )}
              </div>

              {/* Time-based work (a walk, a row) has no meaningful rep count —
                  showing "1 rep" for a 9 minute walk was the old behaviour. */}
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {ex.current.sets} {ex.current.sets === 1 ? 'set' : 'sets'}
                {ex.current.durationSec > 0 && ` · ${clock(ex.current.durationSec)}`}
                {ex.current.distanceM > 0 && ` · ${dist(ex.current.distanceM)}`}
                {ex.current.totalReps > 0 && ` · ${ex.current.totalReps} reps`}
                {ex.current.topWeightKg != null && ` · top ${w(ex.current.topWeightKg)} ${unit}`}
                {ex.current.volumeKg > 0 && ` · ${vol(ex.current.volumeKg)} ${unit} volume`}
              </p>

              {ex.isFirstTime || !ex.delta || !ex.previous ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  No previous session to compare against.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <DeltaChip label="Top weight" value={ex.delta.topWeightKg} format={(v) => `${w(Math.abs(v))} ${unit}`} />
                    {(ex.current.durationSec > 0 || ex.previous.durationSec > 0) && (
                      <DeltaChip label="Time" value={ex.delta.durationSec} format={(v) => clock(Math.abs(v))} />
                    )}
                    {(ex.current.distanceM > 0 || ex.previous.distanceM > 0) && (
                      <DeltaChip label="Distance" value={ex.delta.distanceM} format={(v) => dist(Math.abs(v))} />
                    )}
                    {(ex.current.totalReps > 0 || ex.previous.totalReps > 0) && (
                      <DeltaChip label="Reps" value={ex.delta.totalReps} format={(v) => String(Math.abs(v))} />
                    )}
                    <DeltaChip label="Sets" value={ex.delta.sets} format={(v) => String(Math.abs(v))} />
                    {(ex.current.volumeKg > 0 || ex.previous.volumeKg > 0) && (
                      <DeltaChip label="Volume" value={ex.delta.volumeKg} format={(v) => `${vol(Math.abs(v))} ${unit}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Last time
                    {ex.previousDate &&
                      ` (${new Date(ex.previousDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`}
                    : {ex.previous.sets} {ex.previous.sets === 1 ? 'set' : 'sets'}
                    {ex.previous.durationSec > 0 && ` · ${clock(ex.previous.durationSec)}`}
                    {ex.previous.distanceM > 0 && ` · ${dist(ex.previous.distanceM)}`}
                    {ex.previous.totalReps > 0 && ` · ${ex.previous.totalReps} reps`}
                    {ex.previous.topWeightKg != null && ` · top ${w(ex.previous.topWeightKg)} ${unit}`}
                  </p>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Coach's read on this one session. Opt-in: it spends an AI call, and
          the recap above is useful on its own without one. */}
      <CoachReviewCard
        title="Coach's pointers on this session"
        blurb="Looks at what you just did against the last time you did it, and says what to change next time."
        buttonLabel="Coach this session"
        loadingLabel="Reading this session…"
        started={coachStarted || sessionReviewData != null}
        isLoading={sessionReview.isFetching && sessionReviewData == null}
        isFetching={sessionReview.isFetching}
        error={sessionReview.error}
        review={sessionReviewData?.review ?? null}
        model={sessionReviewData?.model}
        onStart={() => { coachMode.current = 'generate'; setCoachStarted(true); sessionReview.refetch(); }}
        onRefresh={() => { coachMode.current = 'refresh'; sessionReview.refetch(); }}
      />

      <Button onClick={() => router.push('/workouts')} className="w-full">Done</Button>
    </div>
  );
}

/** null = not comparable (e.g. an unloaded session on either side). */
function DeltaChip({
  label, value, format,
}: { label: string; value: number | null; format: (v: number) => string }) {
  if (value == null) return null;

  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  const tone = flat
    ? 'text-gray-400 dark:text-gray-500'
    : value > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400';

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Icon className="h-3 w-3" />
        {flat ? 'same' : format(value)}
      </span>
    </span>
  );
}
