'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { SetRow } from '@/components/workout/SetRow';
import { RestTimer } from '@/components/workout/RestTimer';
import { ExerciseSearchForm } from '@/components/exercise/ExerciseSearchForm';
import { WORKOUT_TYPE_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Workout, WorkoutSet, Exercise } from '@fittrackr/shared';
import { useAuth } from '@/providers/AuthProvider';
import { ChevronLeft, Plus, Trash2, Timer } from 'lucide-react';
import Link from 'next/link';

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showExerciseSearch, setShowExerciseSearch] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => apiFetch<{ data: Workout & { sets: WorkoutSet[] } }>(`/workouts/${id}`),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: 'METRIC' | 'IMPERIAL' } }>('/users/me/settings'),
  });

  const addSetMutation = useMutation({
    mutationFn: (exerciseId: string) =>
      apiFetch(`/workouts/${id}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          setNumber: (workout?.sets?.filter((s) => s.exerciseId === exerciseId).length ?? 0) + 1,
          reps: null,
          weightKg: null,
          isWarmup: false,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setShowExerciseSearch(false);
      setSelectedExercise(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.replace('/workouts'),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;

  const workout = data?.data;
  if (!workout) return null;

  const units = settingsData?.data?.preferredUnits ?? 'METRIC';

  // Group sets by exercise
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of workout.sets ?? []) {
    const key = set.exerciseId;
    if (!byExercise.has(key)) byExercise.set(key, []);
    byExercise.get(key)!.push(set);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/workouts" className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{workout.name ?? WORKOUT_TYPE_LABELS[workout.workoutType]}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {new Date(workout.logDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
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
          <RestTimer />
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
            return (
              <Card key={exerciseId} className="p-0 overflow-hidden">
                <div
                  className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800"
                  style={{ borderLeftColor: (MUSCLE_GROUP_COLORS as any)[primaryMuscle], borderLeftWidth: 3 }}
                >
                  <p className="text-sm font-semibold flex-1">{exerciseName}</p>
                  <span className="text-xs text-gray-500">{workingSets.length} sets</span>
                </div>
                <div className="px-3 py-1 divide-y divide-gray-50 dark:divide-gray-800">
                  {sets.map((set, i) => (
                    <SetRow
                      key={set.id}
                      set={set}
                      workoutId={id}
                      setIndex={i + 1}
                      units={units}
                      onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workout', id] })}
                    />
                  ))}
                </div>
                <div className="px-3 pb-2">
                  <button
                    type="button"
                    onClick={() => addSetMutation.mutate(exerciseId)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add set
                  </button>
                </div>
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
