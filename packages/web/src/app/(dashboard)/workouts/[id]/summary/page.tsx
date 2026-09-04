'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { DurationEditModal } from '@/components/workout/DurationEditModal';
import { CelebrationBurst, consumeCelebrate } from '@/components/workout/CelebrationBurst';
import { ChevronLeft, Trophy, TrendingUp, TrendingDown, Minus, Sparkles, Pencil } from 'lucide-react';
import { WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import { formatDuration } from '@/lib/utils';

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
        <Link
          href="/workouts"
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
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
