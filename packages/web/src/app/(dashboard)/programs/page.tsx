'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import type { Program, ProgramData, WorkoutType, Exercise, MuscleGroup } from '@fittrackr/shared';
import { Sparkles, Calendar, Trash2, CheckCircle, ChevronDown, ChevronUp, Play, BarChart3 } from 'lucide-react';
import { todayString } from '@/lib/utils';

/** Infer muscle group, equipment and category from an exercise name + workout type. */
function inferExerciseDetails(name: string, workoutType: WorkoutType) {
  const n = name.toLowerCase();

  // Equipment
  let equipment = 'BODYWEIGHT';
  if (n.includes('barbell')) equipment = 'BARBELL';
  else if (n.includes('dumbbell')) equipment = 'DUMBBELL';
  else if (n.includes('cable')) equipment = 'CABLE';
  else if (n.includes('machine') || n.includes('smith')) equipment = 'MACHINE';
  else if (n.includes('kettlebell')) equipment = 'KETTLEBELL';
  else if (n.includes('band') || n.includes('resistance')) equipment = 'BANDS';

  // Category
  const compoundKw = ['press', 'squat', 'deadlift', 'row', 'pull', 'dip', 'lunge', 'clean', 'snatch', 'thrust'];
  const category = compoundKw.some((kw) => n.includes(kw)) ? 'COMPOUND' : 'ISOLATION';

  // Primary muscle
  let primaryMuscle: MuscleGroup = 'FULL_BODY';
  if (n.includes('chest') || n.includes('pec') || n.includes('fly') || n.includes('flye') ||
      (n.includes('bench') && !n.includes('row'))) {
    primaryMuscle = 'CHEST';
  } else if (n.includes('tricep') || n.includes('pushdown') ||
      (n.includes('extension') && !n.includes('leg') && !n.includes('back'))) {
    primaryMuscle = 'TRICEPS';
  } else if (n.includes('bicep') || n.includes('biceps') ||
      (n.includes('curl') && !n.includes('leg') && !n.includes('ham'))) {
    primaryMuscle = 'BICEPS';
  } else if (n.includes('shoulder') || n.includes('delt') || n.includes('lateral raise') ||
      n.includes('overhead press') || n.includes('military')) {
    primaryMuscle = 'SHOULDERS';
  } else if (n.includes('lat ') || n.includes('lats') || n.includes(' row') || n.includes('pulldown') ||
      n.includes('pull-up') || n.includes('pullup') || n.includes('back') ||
      (n.includes('deadlift') && !n.includes('romanian') && !n.includes('rdl'))) {
    primaryMuscle = 'BACK';
  } else if (n.includes('quad') || n.includes('squat') || n.includes('leg press') || n.includes('lunge')) {
    primaryMuscle = 'QUADS';
  } else if (n.includes('hamstring') || n.includes('rdl') || n.includes('romanian') || n.includes('leg curl')) {
    primaryMuscle = 'HAMSTRINGS';
  } else if (n.includes('glute') || n.includes('hip thrust') || n.includes('hip hinge')) {
    primaryMuscle = 'GLUTES';
  } else if (n.includes('calf') || n.includes('calves') || n.includes('gastrocnemius')) {
    primaryMuscle = 'CALVES';
  } else if (n.includes('core') || n.includes(' ab') || n.includes('crunch') || n.includes('plank') ||
      n.includes('sit-up') || n.includes('situp')) {
    primaryMuscle = 'CORE';
  } else if (n.includes('forearm') || n.includes('wrist')) {
    primaryMuscle = 'FOREARMS';
  } else {
    // Fall back to primary muscle for the workout type
    const typeMap: Partial<Record<WorkoutType, MuscleGroup>> = {
      PUSH: 'CHEST', PULL: 'BACK', LEGS: 'QUADS',
      UPPER: 'CHEST', LOWER: 'QUADS', FULL_BODY: 'FULL_BODY',
    };
    primaryMuscle = typeMap[workoutType] ?? 'FULL_BODY';
  }

  return { primaryMuscle, equipment, category };
}

const GOAL_LABELS: Record<string, string> = {
  STRENGTH: 'Build Strength',
  HYPERTROPHY: 'Build Muscle',
  ENDURANCE: 'Endurance',
  WEIGHT_LOSS: 'Lose Weight',
  GENERAL_FITNESS: 'General Fitness',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function ProgramsPage() {
  const queryClient = useQueryClient();
  const today = todayString();

  const [showGenerator, setShowGenerator] = useState(false);
  const [form, setForm] = useState({
    durationWeeks: 8,
    workoutsPerWeek: 4,
    primaryGoal: 'HYPERTROPHY',
    experienceLevel: 'INTERMEDIATE',
    availableEquipment: [] as string[],
    preferences: '',
    preferredDays: [1, 3, 5, 6] as number[], // Mon, Wed, Fri, Sat by default
  });

  // Expanded program state: which program is expanded, which week, which day
  const [expanded, setExpanded] = useState<{
    programId: string;
    weekIdx: number;
    dayOfWeek: number | null;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: () => apiFetch<{ data: Program[] }>('/programs'),
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      const dayNames = form.preferredDays.map((d) => DAY_LABELS[d - 1]).join(', ');
      const fullPreferences = [
        form.preferences,
        `Preferred training days: ${dayNames}. Schedule all workouts on these days only.`,
      ].filter(Boolean).join(' ');
      return apiFetch('/programs/generate', {
        method: 'POST',
        body: JSON.stringify({ ...form, preferences: fullPreferences }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setShowGenerator(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/programs/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  });

  const startWorkoutMutation = useMutation({
    mutationFn: async ({
      workoutType,
      logDate,
      exercises,
      programId,
      programWeek,
      programDay,
    }: {
      workoutType: WorkoutType;
      logDate: string;
      programId?: string;
      programWeek?: number;
      programDay?: number;
      exercises: Array<{
        name: string;
        sets: number;
        reps: string | number;
        rpe?: number;
        primaryMuscle?: string;
        equipment?: string;
        category?: string;
      }>;
    }) => {
      const res = await apiFetch<{ data: { id: string } }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({
          logDate, workoutType, name: WORKOUT_TYPE_LABELS[workoutType],
          programId, programWeek, programDay,
        }),
      });
      const workoutId = res.data.id;

      for (const ex of exercises) {
        try {
          const searchRes = await apiFetch<{ data: Exercise[] }>(
            `/exercises?search=${encodeURIComponent(ex.name)}&limit=5`,
          );
          let match: Exercise | undefined = searchRes.data[0];

          // If nothing found, auto-create the exercise so it always gets added
          if (!match) {
            // Prefer AI-provided fields; fall back to inference for older programs
            const inferred = inferExerciseDetails(ex.name, workoutType);
            const created = await apiFetch<{ data: Exercise }>('/exercises', {
              method: 'POST',
              body: JSON.stringify({
                name: ex.name,
                secondaryMuscles: [],
                primaryMuscle: ex.primaryMuscle ?? inferred.primaryMuscle,
                equipment: ex.equipment ?? inferred.equipment,
                category: ex.category ?? inferred.category,
              }),
            });
            match = created.data;
          }

          // Parse rep range from program (e.g. "8-12" → min=8, max=12, target=8)
          const repsStr = String(ex.reps);
          const repParts = repsStr.split('-').map((p) => parseInt(p.trim())).filter((n) => !isNaN(n));
          const repRangeMin = repParts[0] ?? null;
          const repRangeMax = repParts[1] ?? repParts[0] ?? null;
          const targetReps = repRangeMin;

          // Save rep range to user preferences for this exercise
          if (repRangeMin != null) {
            apiFetch(`/exercises/${match.id}/preference`, {
              method: 'PATCH',
              body: JSON.stringify({ repRangeMin, repRangeMax, targetSets: ex.sets }),
            }).catch(() => {});
          }

          // Fetch last working weight for progressive overload
          let weightKg: number | null = null;
          try {
            const lastSet = await apiFetch<{ data: { weightKg: number | null; reps: number | null } | null }>(
              `/exercises/${match.id}/last-set`,
            );
            weightKg = lastSet.data?.weightKg ?? null;
          } catch { /* no history — leave null */ }

          for (let i = 0; i < ex.sets; i++) {
            await apiFetch(`/workouts/${workoutId}/sets`, {
              method: 'POST',
              body: JSON.stringify({
                exerciseId: match.id,
                setNumber: i + 1,
                reps: targetReps,
                weightKg,
                rpe: ex.rpe ?? null,
                isWarmup: false,
              }),
            });
          }
        } catch { /* skip exercises that can't be found */ }
      }

      return res;
    },
    onSuccess: (res) => {
      window.location.href = `/workouts/${res.data.id}`;
    },
  });

  const programs = data?.data ?? [];

  function toggleDay(programId: string, weekIdx: number, dayOfWeek: number) {
    if (expanded?.programId === programId && expanded.weekIdx === weekIdx && expanded.dayOfWeek === dayOfWeek) {
      setExpanded((e) => e ? { ...e, dayOfWeek: null } : null);
    } else {
      setExpanded({ programId, weekIdx, dayOfWeek });
    }
  }

  function toggleProgram(programId: string) {
    if (expanded?.programId === programId) {
      setExpanded(null);
    } else {
      setExpanded({ programId, weekIdx: 0, dayOfWeek: null });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Programs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">AI-generated training programs</p>
        </div>
        <Button onClick={() => setShowGenerator(true)} className="gap-1.5">
          <Sparkles className="h-4 w-4" />
          Generate
        </Button>
      </div>

      {showGenerator && (
        <Card className="space-y-4" data-tutorial="program-generator">
          <h2 className="font-semibold">Generate New Program</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Goal</label>
              <select
                value={form.primaryGoal}
                onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {Object.entries(GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Experience</label>
              <select
                value={form.experienceLevel}
                onChange={(e) => setForm((f) => ({ ...f, experienceLevel: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Duration</label>
              <select
                value={form.durationWeeks}
                onChange={(e) => setForm((f) => ({ ...f, durationWeeks: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {[4, 6, 8, 10, 12, 16].map((w) => <option key={w} value={w}>{w} weeks</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Days/week</label>
              <select
                value={form.workoutsPerWeek}
                onChange={(e) => setForm((f) => ({ ...f, workoutsPerWeek: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
          </div>

          {/* Preferred training days */}
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-2">Preferred Training Days</label>
            <div className="flex gap-1.5">
              {DAY_SHORT.map((label, i) => {
                const dayNum = i + 1;
                const selected = form.preferredDays.includes(dayNum);
                return (
                  <button
                    key={dayNum}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        preferredDays: selected
                          ? f.preferredDays.filter((d) => d !== dayNum)
                          : [...f.preferredDays, dayNum].sort(),
                      }))
                    }
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <textarea
            value={form.preferences}
            onChange={(e) => setForm((f) => ({ ...f, preferences: e.target.value }))}
            placeholder="Any preferences or injuries to note? (optional)"
            rows={2}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="flex-1 gap-2">
              {generateMutation.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {generateMutation.isPending ? 'Generating…' : 'Generate Program'}
            </Button>
            <Button variant="outline" onClick={() => setShowGenerator(false)}>Cancel</Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-red-500">
              {(generateMutation.error as Error)?.message || 'Failed to generate. Check your AI API key in Settings.'}
            </p>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : programs.length === 0 ? (
        <Card className="py-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50">
            <Calendar className="h-6 w-6 text-indigo-500" />
          </div>
          <p className="font-semibold text-gray-700 dark:text-gray-200">No programs yet</p>
          <p className="mt-1 text-sm text-gray-500">Generate a personalized program with AI</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => {
            const pd = p.programData as ProgramData;
            const isExpanded = expanded?.programId === p.id;
            const weekIdx = expanded?.programId === p.id ? expanded.weekIdx : 0;
            const currentWeek = pd.weeks?.[weekIdx];
            const selectedDayOfWeek = expanded?.programId === p.id ? expanded.dayOfWeek : null;
            const selectedDay = selectedDayOfWeek != null
              ? currentWeek?.days?.find((d) => d.dayOfWeek === selectedDayOfWeek)
              : null;

            return (
              <Card key={p.id} className="p-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{p.name}</p>
                      {p.isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/40 px-1.5 py-0.5 rounded-full font-medium">
                          <CheckCircle className="h-2.5 w-2.5" /> Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{p.durationWeeks} weeks · {p.aiModel}</p>
                  </div>
                  <Link
                    href={`/programs/${p.id}/summary`}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 transition-colors"
                    aria-label="Program summary"
                    title="Program summary"
                  >
                    <BarChart3 className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggleProgram(p.id)}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 transition-colors"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (confirm('Delete this program?')) deleteMutation.mutate(p.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Week selector sits ABOVE the day strip: you pick the week
                    first, then the day within it. */}
                {isExpanded && pd.weeks && pd.weeks.length > 1 && (
                  <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-none">
                    {pd.weeks.map((w, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setExpanded((e) => e ? { ...e, weekIdx: i, dayOfWeek: null } : null)}
                        className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          weekIdx === i
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        Week {w.weekNumber}
                      </button>
                    ))}
                  </div>
                )}

                {/* Day strip for the selected week (always visible) */}
                <div className="px-4 pb-3">
                  <div className="grid grid-cols-7 gap-1">
                    {DAY_SHORT.map((label, i) => {
                      const dayNum = i + 1;
                      const dayData = currentWeek?.days?.find((d) => d.dayOfWeek === dayNum);
                      const isSelected = isExpanded && selectedDayOfWeek === dayNum;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (!isExpanded) setExpanded({ programId: p.id, weekIdx: 0, dayOfWeek: dayData ? dayNum : null });
                            else if (dayData) toggleDay(p.id, weekIdx, dayNum);
                          }}
                          disabled={!dayData}
                          className={`flex flex-col items-center gap-0.5 py-2 rounded-lg text-center transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : dayData
                              ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800/30 hover:border-indigo-400 cursor-pointer'
                              : 'bg-gray-50 dark:bg-gray-800/50 opacity-50'
                          }`}
                        >
                          <span className={`text-[9px] font-medium ${isSelected ? 'text-indigo-100' : 'text-gray-500'}`}>{label}</span>
                          {dayData && (
                            <span className={`text-[9px] font-bold leading-tight ${isSelected ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}`}>
                              {dayData.workoutType.slice(0, 3)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    {/* Day exercise detail */}
                    {selectedDay ? (
                      <div className="px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">
                              {DAY_LABELS[selectedDayOfWeek! - 1]} — {selectedDay.focus}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">{WORKOUT_TYPE_LABELS[selectedDay.workoutType]}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => startWorkoutMutation.mutate({
                              workoutType: selectedDay.workoutType,
                              logDate: today,
                              exercises: selectedDay.exercises,
                              programId: p.id,
                              programWeek: currentWeek?.weekNumber ?? weekIdx + 1,
                              programDay: selectedDayOfWeek ?? undefined,
                            })}
                            disabled={startWorkoutMutation.isPending}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
                          >
                            {startWorkoutMutation.isPending ? <Spinner /> : <Play className="h-3 w-3" />}
                            Start Workout
                          </button>
                        </div>

                        <div className="space-y-1">
                          {selectedDay.exercises.map((ex, i) => (
                            <div key={i} className="flex items-start gap-3 py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold flex items-center justify-center mt-0.5">
                                {i + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight">{ex.name}</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {ex.sets} sets × {ex.reps} reps
                                  {ex.rpe ? ` · RPE ${ex.rpe}` : ''}
                                </p>
                                {ex.notes && (
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">{ex.notes}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {pd.notes && weekIdx === 0 && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 italic pt-1">{pd.notes}</p>
                        )}
                      </div>
                    ) : (
                      <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                        Tap a training day above to see exercises
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
