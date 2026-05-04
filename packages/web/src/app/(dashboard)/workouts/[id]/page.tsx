'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { SetRow } from '@/components/workout/SetRow';
import { RestTimer } from '@/components/workout/RestTimer';
import { ExerciseSearchForm } from '@/components/exercise/ExerciseSearchForm';
import { ProgressiveOverloadPanel } from '@/components/workout/ProgressiveOverloadPanel';
import { WORKOUT_TYPE_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Workout, WorkoutSet, Exercise } from '@fittrackr/shared';
import { useAuth } from '@/providers/AuthProvider';
import { parseDateLocal } from '@/lib/utils';
import { ChevronLeft, Plus, Trash2, Timer, Sparkles, Check, X, Flame } from 'lucide-react';
import Link from 'next/link';

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showExerciseSearch, setShowExerciseSearch] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restTimerTrigger, setRestTimerTrigger] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [editingRepRange, setEditingRepRange] = useState<Map<string, boolean>>(new Map());
  const [repRangeEdits, setRepRangeEdits] = useState<Record<string, { min: string; max: string }>>({});
  const [showAiPanel, setShowAiPanel] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => apiFetch<{ data: Workout & { sets: WorkoutSet[] } }>(`/workouts/${id}`),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: 'METRIC' | 'IMPERIAL' } }>('/users/me/settings'),
  });

  const exerciseIds = [...(data?.data?.sets ?? [])].map(s => s.exerciseId).filter((v, i, a) => a.indexOf(v) === i);

  const prefsQuery = useQuery({
    queryKey: ['exercise-prefs', exerciseIds],
    queryFn: async () => {
      const results = await Promise.all(
        exerciseIds.map(eid =>
          apiFetch<{ data: { repRangeMin: number | null; repRangeMax: number | null; targetSets: number | null } | null }>(
            `/exercises/${eid}/preference`
          ).then(r => [eid, r.data] as const)
        )
      );
      return Object.fromEntries(results) as Record<string, { repRangeMin: number | null; repRangeMax: number | null; targetSets: number | null } | null>;
    },
    enabled: exerciseIds.length > 0,
  });

  const workout = data?.data;

  const addSetMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];

      let weightKg: number | null = null;
      let reps: number | null = null;

      if (existingSets.length > 0) {
        // Copy from last set in current workout
        const last = existingSets[existingSets.length - 1];
        weightKg = last.weightKg ?? null;
        reps = last.reps ?? null;
      } else {
        // Fetch from previous workouts
        try {
          const lastSet = await apiFetch<{ data: { weightKg: number | null; reps: number | null; rpe: number | null } | null }>(
            `/exercises/${exerciseId}/last-set?excludeWorkoutId=${id}`
          );
          weightKg = lastSet.data?.weightKg ?? null;
          reps = lastSet.data?.reps ?? null;
        } catch {
          // If fetch fails, proceed with null values
        }
      }

      return apiFetch(`/workouts/${id}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          setNumber: existingSets.length + 1,
          reps,
          weightKg,
          isWarmup: false,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setShowExerciseSearch(false);
      setSelectedExercise(null);
    },
  });

  const addWarmupMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];
      const workingSets = existingSets.filter((s) => !s.isWarmup);
      const workingWeight = workingSets.length > 0 ? workingSets[workingSets.length - 1].weightKg : null;
      const warmupWeight = workingWeight != null ? Math.round(workingWeight * 0.5 * 4) / 4 : null;
      return apiFetch(`/workouts/${id}/sets`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, setNumber: existingSets.length + 1, reps: null, weightKg: warmupWeight, isWarmup: true }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const WARMUP_LADDER = [
    { pct: 0.4, reps: 8 },
    { pct: 0.6, reps: 5 },
    { pct: 0.75, reps: 3 },
  ];

  const addWarmupLadderMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];
      const workingSets = existingSets.filter((s) => !s.isWarmup);
      let workingWeightKg: number | null = workingSets.length > 0
        ? (workingSets[workingSets.length - 1].weightKg ?? null)
        : null;
      if (workingWeightKg === null) {
        try {
          const lastSet = await apiFetch<{ data: { weightKg: number | null } | null }>(
            `/exercises/${exerciseId}/last-set?excludeWorkoutId=${id}`
          );
          workingWeightKg = lastSet.data?.weightKg ?? null;
        } catch { /* proceed with null */ }
      }
      let setNumber = existingSets.length + 1;
      for (const step of WARMUP_LADDER) {
        const weightKg = workingWeightKg != null ? Math.round(workingWeightKg * step.pct * 4) / 4 : null;
        await apiFetch(`/workouts/${id}/sets`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, setNumber: setNumber++, reps: step.reps, weightKg, isWarmup: true }),
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.replace('/workouts'),
  });

  const saveRepRangeMutation = useMutation({
    mutationFn: ({ exerciseId, repRangeMin, repRangeMax }: { exerciseId: string; repRangeMin: number | null; repRangeMax: number | null }) =>
      apiFetch(`/exercises/${exerciseId}/preference`, {
        method: 'PATCH',
        body: JSON.stringify({ repRangeMin, repRangeMax }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercise-prefs'] });
    },
  });

  // Duration clock
  useEffect(() => {
    if (!workout?.createdAt) return;
    const start = new Date(workout.createdAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [workout?.createdAt]);

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;

  if (!workout) return null;

  const units = settingsData?.data?.preferredUnits ?? 'METRIC';

  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const durationDisplay = hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  function handleSetLogged() {
    setShowRestTimer(true);
    setRestTimerTrigger((t) => t + 1);
  }

  // Group sets by exercise, warmups sorted to top within each group
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of workout.sets ?? []) {
    const key = set.exerciseId;
    if (!byExercise.has(key)) byExercise.set(key, []);
    byExercise.get(key)!.push(set);
  }
  for (const [key, sets] of byExercise) {
    byExercise.set(key, [...sets].sort((a, b) => {
      if (a.isWarmup && !b.isWarmup) return -1;
      if (!a.isWarmup && b.isWarmup) return 1;
      return a.setNumber - b.setNumber;
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/workouts" className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{workout.name ?? WORKOUT_TYPE_LABELS[workout.workoutType]}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {parseDateLocal(String(workout.logDate).split('T')[0]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
            <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{durationDisplay}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowRestTimer((v) => !v)}
          className={`p-2 rounded-lg transition-colors ${showRestTimer ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          title="Rest timer"
        >
          <Timer className="h-4 w-4" />
        </button>
      </div>

      {showRestTimer && (
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Rest Timer</p>
          <RestTimer triggerStart={restTimerTrigger} />
        </Card>
      )}

      {/* Sets grouped by exercise */}
      {byExercise.size === 0 ? (
        <Card className="py-8 text-center">
          <p className="font-semibold text-gray-700 dark:text-gray-200">No exercises yet</p>
          <p className="text-sm text-gray-500 mt-1">Tap + to add your first exercise</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...byExercise.entries()].map(([exerciseId, sets]) => {
            const exerciseName = sets[0]?.exercise?.name ?? 'Exercise';
            const primaryMuscle = sets[0]?.exercise?.primaryMuscle ?? 'FULL_BODY';
            const workingSets = sets.filter((s) => !s.isWarmup);
            const pref = prefsQuery.data?.[exerciseId];
            const isEditingRange = editingRepRange.get(exerciseId) ?? false;

            const enterRepRangeEdit = () => {
              setRepRangeEdits(prev => ({
                ...prev,
                [exerciseId]: {
                  min: pref?.repRangeMin != null ? String(pref.repRangeMin) : '',
                  max: pref?.repRangeMax != null ? String(pref.repRangeMax) : '',
                },
              }));
              setEditingRepRange(prev => new Map(prev).set(exerciseId, true));
            };

            const cancelRepRangeEdit = () => {
              setEditingRepRange(prev => {
                const next = new Map(prev);
                next.delete(exerciseId);
                return next;
              });
            };

            const saveRepRange = () => {
              const edits = repRangeEdits[exerciseId];
              const repRangeMin = edits?.min ? parseInt(edits.min, 10) : null;
              const repRangeMax = edits?.max ? parseInt(edits.max, 10) : null;
              saveRepRangeMutation.mutate({ exerciseId, repRangeMin, repRangeMax });
              cancelRepRangeEdit();
            };

            return (
              <Card key={exerciseId} className="p-0 overflow-hidden">
                <div
                  className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800"
                  style={{ borderLeftColor: (MUSCLE_GROUP_COLORS as any)[primaryMuscle], borderLeftWidth: 3 }}
                >
                  <p className="text-sm font-semibold flex-1">{exerciseName}</p>

                  {/* Rep range display / edit */}
                  {isEditingRange ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={repRangeEdits[exerciseId]?.min ?? ''}
                        onChange={e => setRepRangeEdits(prev => ({ ...prev, [exerciseId]: { ...prev[exerciseId]!, min: e.target.value } }))}
                        className="w-10 text-xs text-center border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800"
                        placeholder="min"
                      />
                      <span className="text-xs text-gray-400">–</span>
                      <input
                        type="number"
                        min={1}
                        value={repRangeEdits[exerciseId]?.max ?? ''}
                        onChange={e => setRepRangeEdits(prev => ({ ...prev, [exerciseId]: { ...prev[exerciseId]!, max: e.target.value } }))}
                        className="w-10 text-xs text-center border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800"
                        placeholder="max"
                      />
                      <button
                        type="button"
                        onClick={saveRepRange}
                        className="p-0.5 text-green-600 hover:text-green-800"
                        title="Save rep range"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelRepRangeEdit}
                        className="p-0.5 text-gray-400 hover:text-gray-600"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : pref?.repRangeMin != null || pref?.repRangeMax != null ? (
                    <button
                      type="button"
                      onClick={enterRepRangeEdit}
                      className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full"
                    >
                      {pref?.repRangeMin}–{pref?.repRangeMax} reps
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={enterRepRangeEdit}
                      className="text-xs text-gray-400 hover:text-indigo-500"
                    >
                      + range
                    </button>
                  )}

                  {/* AI Progressive Overload button */}
                  <button
                    type="button"
                    onClick={() => setShowAiPanel(showAiPanel === exerciseId ? null : exerciseId)}
                    className={`p-1 rounded-lg transition-colors ${showAiPanel === exerciseId ? 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40' : 'text-gray-400 hover:text-indigo-500'}`}
                    title="AI progressive overload"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </button>

                  <span className="text-xs text-gray-500">{workingSets.length} sets</span>
                </div>
                <div className="px-3 py-1 divide-y divide-gray-50 dark:divide-gray-800">
                  {(() => {
                    let workingCount = 0;
                    return sets.map((set) => {
                      if (!set.isWarmup) workingCount++;
                      return (
                        <SetRow
                          key={set.id}
                          set={set}
                          workoutId={id}
                          setIndex={workingCount}
                          units={units}
                          onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workout', id] })}
                          onSetLogged={handleSetLogged}
                        />
                      );
                    });
                  })()}
                </div>
                <div className="px-3 pb-2 flex items-center gap-4 flex-wrap">
                  <button
                    type="button"
                    onClick={() => addSetMutation.mutate(exerciseId)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add set
                  </button>
                  <button
                    type="button"
                    onClick={() => addWarmupMutation.mutate(exerciseId)}
                    className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add warmup
                  </button>
                  <button
                    type="button"
                    onClick={() => addWarmupLadderMutation.mutate(exerciseId)}
                    disabled={addWarmupLadderMutation.isPending}
                    className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium flex items-center gap-1 disabled:opacity-40"
                  >
                    <Flame className="h-3 w-3" /> Warmup ladder
                  </button>
                </div>
                {showAiPanel === exerciseId && (
                  <div className="px-3 pb-3">
                    <ProgressiveOverloadPanel
                      exerciseId={exerciseId}
                      exerciseName={exerciseName}
                      workoutId={id}
                      units={units}
                      repRangeMin={prefsQuery.data?.[exerciseId]?.repRangeMin}
                      repRangeMax={prefsQuery.data?.[exerciseId]?.repRangeMax}
                      onClose={() => setShowAiPanel(null)}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add exercise */}
      {showExerciseSearch ? (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Add Exercise</p>
            <button type="button" onClick={() => setShowExerciseSearch(false)} className="text-xs text-gray-500">Cancel</button>
          </div>
          <ExerciseSearchForm
            onSelect={(ex) => {
              setSelectedExercise(ex);
              addSetMutation.mutate(ex.id);
            }}
          />
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setShowExerciseSearch(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-all"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">Add Exercise</span>
        </button>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => {
            if (confirm('Delete this workout?')) deleteMutation.mutate();
          }}
          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete workout
        </button>
      </div>
    </div>
  );
}
