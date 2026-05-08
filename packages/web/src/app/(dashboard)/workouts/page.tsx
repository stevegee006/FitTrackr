'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS, MUSCLE_GROUP_LABELS } from '@fittrackr/shared';
import type { Workout, WorkoutType, Exercise, MuscleGroup } from '@fittrackr/shared';
import { todayString, parseDateLocal, formatDate } from '@/lib/utils';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Dumbbell, Clock, Sparkles, Camera, X, Check, ImageIcon } from 'lucide-react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonthBounds(year: number, month: number) {
  return {
    firstDay: formatDate(new Date(year, month, 1)),
    lastDay: formatDate(new Date(year, month + 1, 0)),
  };
}

function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

interface AiExercise {
  name: string;
  sets: number;
  reps: string;
  rpe?: number;
  notes?: string;
  primaryMuscle?: string;
  equipment?: string;
  category?: string;
}

interface AiWorkout {
  name: string;
  workoutType: WorkoutType;
  exercises: AiExercise[];
}

function inferExerciseDetails(name: string, workoutType: WorkoutType) {
  const n = name.toLowerCase();
  let equipment = 'BODYWEIGHT';
  if (n.includes('barbell')) equipment = 'BARBELL';
  else if (n.includes('dumbbell')) equipment = 'DUMBBELL';
  else if (n.includes('cable')) equipment = 'CABLE';
  else if (n.includes('machine') || n.includes('smith')) equipment = 'MACHINE';
  else if (n.includes('kettlebell')) equipment = 'KETTLEBELL';
  else if (n.includes('band')) equipment = 'BANDS';

  const compoundKw = ['press', 'squat', 'deadlift', 'row', 'pull', 'dip', 'lunge', 'thrust'];
  const category = compoundKw.some((kw) => n.includes(kw)) ? 'COMPOUND' : 'ISOLATION';

  let primaryMuscle: MuscleGroup = 'FULL_BODY';
  if (n.includes('chest') || n.includes('pec') || n.includes('fly') || (n.includes('bench') && !n.includes('row'))) primaryMuscle = 'CHEST';
  else if (n.includes('tricep') || (n.includes('extension') && !n.includes('leg'))) primaryMuscle = 'TRICEPS';
  else if (n.includes('bicep') || (n.includes('curl') && !n.includes('leg'))) primaryMuscle = 'BICEPS';
  else if (n.includes('shoulder') || n.includes('delt') || n.includes('lateral raise')) primaryMuscle = 'SHOULDERS';
  else if (n.includes('lat') || n.includes('row') || n.includes('pulldown') || n.includes('pull-up') || n.includes('back')) primaryMuscle = 'BACK';
  else if (n.includes('quad') || n.includes('squat') || n.includes('leg press') || n.includes('lunge')) primaryMuscle = 'QUADS';
  else if (n.includes('hamstring') || n.includes('rdl') || n.includes('romanian')) primaryMuscle = 'HAMSTRINGS';
  else if (n.includes('glute') || n.includes('hip thrust')) primaryMuscle = 'GLUTES';
  else if (n.includes('calf') || n.includes('calves')) primaryMuscle = 'CALVES';
  else if (n.includes('core') || n.includes('crunch') || n.includes('plank')) primaryMuscle = 'CORE';
  else {
    const map: Partial<Record<WorkoutType, MuscleGroup>> = { PUSH: 'CHEST', PULL: 'BACK', LEGS: 'QUADS', UPPER: 'CHEST', LOWER: 'QUADS' };
    primaryMuscle = map[workoutType] ?? 'FULL_BODY';
  }

  return { primaryMuscle, equipment, category };
}

export default function WorkoutsPage() {
  const queryClient = useQueryClient();
  const today = todayString();
  const todayDate = parseDateLocal(today);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // AI flow state
  type FlowMode = null | 'ai-generate' | 'import';
  const [flowMode, setFlowMode] = useState<FlowMode>(null);
  const [aiForm, setAiForm] = useState({ workoutType: '' as WorkoutType | '', preferences: '' });
  const [aiPreview, setAiPreview] = useState<AiWorkout | null>(null);
  const [aiError, setAiError] = useState('');
  const [importImage, setImportImage] = useState<string | null>(null);
  const [importFilename, setImportFilename] = useState('');

  const viewYear = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1).getFullYear();
  const viewMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1).getMonth();
  const { firstDay, lastDay } = getMonthBounds(viewYear, viewMonth);

  const { data, isLoading } = useQuery({
    queryKey: ['workouts', firstDay, lastDay],
    queryFn: () => apiFetch<{ data: Workout[] }>(`/workouts?from=${firstDay}&to=${lastDay}&limit=100`),
  });

  const createMutation = useMutation({
    mutationFn: ({ workoutType, logDate }: { workoutType: WorkoutType; logDate: string }) =>
      apiFetch<{ data: Workout }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ logDate, workoutType, name: WORKOUT_TYPE_LABELS[workoutType] }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      window.location.href = `/workouts/${res.data.id}`;
    },
  });

  // AI generate workout preview
  const aiGenerateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: AiWorkout }>('/workouts/ai-generate', {
        method: 'POST',
        body: JSON.stringify({ workoutType: aiForm.workoutType || undefined, preferences: aiForm.preferences || undefined }),
      }),
    onSuccess: (res) => { setAiPreview(res.data); setAiError(''); },
    onError: (err: any) => setAiError(err?.message || 'Generation failed. Check your AI API key in Settings.'),
  });

  // AI import from screenshot
  const aiImportMutation = useMutation({
    mutationFn: (imageBase64: string) =>
      apiFetch<{ data: AiWorkout }>('/workouts/ai-import', {
        method: 'POST',
        body: JSON.stringify({ imageBase64 }),
      }),
    onSuccess: (res) => { setAiPreview(res.data); setAiError(''); },
    onError: (err: any) => setAiError(err?.message || 'Import failed. Check your AI API key in Settings.'),
  });

  // Populate workout with exercises from AI preview
  const populateMutation = useMutation({
    mutationFn: async (workout: AiWorkout) => {
      const res = await apiFetch<{ data: { id: string } }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ logDate: selectedDate, workoutType: workout.workoutType, name: workout.name }),
      });
      const workoutId = res.data.id;

      for (const ex of workout.exercises) {
        try {
          const searchRes = await apiFetch<{ data: Exercise[] }>(`/exercises?search=${encodeURIComponent(ex.name)}&limit=5`);
          let match: Exercise | undefined = searchRes.data[0];

          if (!match) {
            const inferred = inferExerciseDetails(ex.name, workout.workoutType);
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

          const repParts = String(ex.reps).split('-').map((p) => parseInt(p)).filter((n) => !isNaN(n));
          const targetReps = repParts[0] ?? null;
          if (repParts[0] != null) {
            apiFetch(`/exercises/${match.id}/preference`, {
              method: 'PATCH',
              body: JSON.stringify({ repRangeMin: repParts[0], repRangeMax: repParts[1] ?? repParts[0], targetSets: ex.sets }),
            }).catch(() => {});
          }

          let weightKg: number | null = null;
          try {
            const last = await apiFetch<{ data: { weightKg: number | null } | null }>(`/exercises/${match.id}/last-set`);
            weightKg = last.data?.weightKg ?? null;
          } catch { /* no history */ }

          for (let i = 0; i < ex.sets; i++) {
            await apiFetch(`/workouts/${workoutId}/sets`, {
              method: 'POST',
              body: JSON.stringify({ exerciseId: match.id, setNumber: i + 1, reps: targetReps, weightKg, rpe: ex.rpe ?? null, isWarmup: false }),
            });
          }
        } catch { /* skip */ }
      }
      return workoutId;
    },
    onSuccess: (workoutId) => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      window.location.href = `/workouts/${workoutId}`;
    },
  });

  function closeFlow() {
    setFlowMode(null);
    setAiPreview(null);
    setAiError('');
    setImportImage(null);
    setImportFilename('');
    setAiForm({ workoutType: '', preferences: '' });
  }

  function handleImageFile(file: File) {
    setImportFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target?.result as string;
      setImportImage(b64);
      setAiPreview(null);
      setAiError('');
    };
    reader.readAsDataURL(file);
  }

  const workouts = data?.data ?? [];
  const byDate = new Map<string, Workout[]>();
  for (const w of workouts) {
    const d = String(w.logDate).split('T')[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(w);
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startPad = mondayIndex(firstOfMonth);
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selectedWorkouts = byDate.get(selectedDate) ?? [];
  const selectedDateObj = parseDateLocal(selectedDate);
  const selectedLabel = selectedDateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = selectedDate === today;
  const isFuture = selectedDate > today;

  const isAiLoading = aiGenerateMutation.isPending || aiImportMutation.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workouts</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track your training sessions</p>
      </div>

      {/* Calendar */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={() => setMonthOffset((m) => m - 1)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{monthLabel}</span>
          <button type="button" onClick={() => setMonthOffset((m) => Math.min(m + 1, 0))} disabled={monthOffset === 0}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 py-1">{d}</div>
          ))}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="h-11" />;
              const dateStr = formatDate(new Date(viewYear, viewMonth, day));
              const dayWorkouts = byDate.get(dateStr) ?? [];
              const isSelected = dateStr === selectedDate;
              const isTodayCell = dateStr === today;
              return (
                <button key={dateStr} type="button" onClick={() => setSelectedDate(dateStr)}
                  className={`relative h-11 rounded-lg flex flex-col items-center justify-start pt-1 transition-all ${
                    isSelected ? 'bg-indigo-600 text-white'
                    : isTodayCell ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}>
                  <span className={`text-xs leading-none ${isTodayCell && !isSelected ? 'font-bold' : ''}`}>{day}</span>
                  {dayWorkouts.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center px-0.5">
                      {dayWorkouts.slice(0, 3).map((w) => (
                        <div key={w.id} className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: isSelected ? 'white' : (WORKOUT_TYPE_COLORS[w.workoutType] ?? '#6b7280') }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Selected day panel */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{selectedLabel}</p>
          {isToday && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              Today
            </span>
          )}
        </div>

        {selectedWorkouts.length > 0 ? (
          <div className="space-y-2">
            {selectedWorkouts.map((w) => {
              const color = WORKOUT_TYPE_COLORS[w.workoutType] ?? '#6b7280';
              const setCount = (w.sets ?? []).filter((s: any) => !s.isWarmup).length;
              return (
                <Link key={w.id} href={`/workouts/${w.id}`}>
                  <Card className="flex gap-0 p-0 overflow-hidden hover:shadow-md transition-shadow active:scale-[0.99]">
                    <div className="w-1.5 shrink-0 rounded-l-2xl" style={{ backgroundColor: color }} />
                    <div className="flex-1 px-3 py-2.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate">{w.name ?? WORKOUT_TYPE_LABELS[w.workoutType]}</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: color + '20', color }}>
                          {WORKOUT_TYPE_LABELS[w.workoutType]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {setCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Dumbbell className="h-3 w-3" />{setCount} sets
                          </span>
                        )}
                        {w.durationMin && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />{w.durationMin}m
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card className="py-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isFuture ? 'No workout planned' : 'No workout logged'}
            </p>
          </Card>
        )}

        {/* Add workout section */}
        {!isFuture && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {selectedWorkouts.length > 0 ? 'Add another workout' : 'Start a workout'}
            </p>

            {/* Quick type buttons */}
            <div className="grid grid-cols-4 gap-2">
              {(['PUSH', 'PULL', 'LEGS', 'FULL_BODY'] as WorkoutType[]).map((type) => (
                <button key={type} type="button"
                  onClick={() => createMutation.mutate({ workoutType: type, logDate: selectedDate })}
                  disabled={createMutation.isPending}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 transition-all active:scale-95">
                  <span className="text-lg">{type === 'PUSH' ? '🤜' : type === 'PULL' ? '🤛' : type === 'LEGS' ? '🦵' : '💪'}</span>
                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{WORKOUT_TYPE_LABELS[type]}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {(['UPPER', 'LOWER', 'CARDIO', 'CUSTOM'] as WorkoutType[]).map((type) => (
                <button key={type} type="button"
                  onClick={() => createMutation.mutate({ workoutType: type, logDate: selectedDate })}
                  disabled={createMutation.isPending}
                  className="flex-1 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-all active:scale-95">
                  {WORKOUT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {/* AI buttons */}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setFlowMode('ai-generate'); setAiPreview(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors">
                <Sparkles className="h-3.5 w-3.5" />
                AI Generate
              </button>
              <button type="button" onClick={() => { setFlowMode('import'); setAiPreview(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-100 dark:hover:bg-purple-950/50 transition-colors">
                <Camera className="h-3.5 w-3.5" />
                Import Screenshot
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Generate / Import panel ── */}
      {flowMode && (
        <Card className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {flowMode === 'ai-generate'
                ? <Sparkles className="h-4 w-4 text-indigo-500" />
                : <Camera className="h-4 w-4 text-purple-500" />}
              <p className="text-sm font-semibold">
                {flowMode === 'ai-generate' ? 'AI Generate Workout' : 'Import from Screenshot'}
              </p>
            </div>
            <button type="button" onClick={closeFlow} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* AI Generate form */}
          {flowMode === 'ai-generate' && !aiPreview && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Workout Type (optional)</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['', 'PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY', 'CUSTOM'] as (WorkoutType | '')[]).map((t) => (
                    <button key={t} type="button"
                      onClick={() => setAiForm((f) => ({ ...f, workoutType: t }))}
                      className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                        aiForm.workoutType === t
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}>
                      {t === '' ? 'Any' : WORKOUT_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Preferences (optional)</label>
                <textarea
                  value={aiForm.preferences}
                  onChange={(e) => setAiForm((f) => ({ ...f, preferences: e.target.value }))}
                  placeholder="e.g. focus on chest, no barbell today, 45 min session…"
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm resize-none"
                />
              </div>
              {aiError && <p className="text-xs text-red-500">{aiError}</p>}
              <button type="button" onClick={() => aiGenerateMutation.mutate()}
                disabled={isAiLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                {isAiLoading ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                {isAiLoading ? 'Generating…' : 'Generate Workout'}
              </button>
            </div>
          )}

          {/* Import form */}
          {flowMode === 'import' && !aiPreview && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
              />
              {!importImage ? (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center gap-2 py-8 rounded-xl border-2 border-dashed border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-colors">
                  <ImageIcon className="h-8 w-8" />
                  <span className="text-sm font-medium">Tap to select screenshot</span>
                  <span className="text-xs text-gray-400">Whiteboard, app, book, handwritten notes…</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={importImage} alt="Workout screenshot" className="w-full max-h-48 object-cover" />
                    <button type="button" onClick={() => { setImportImage(null); setImportFilename(''); }}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{importFilename}</p>
                </div>
              )}
              {aiError && <p className="text-xs text-red-500">{aiError}</p>}
              {importImage && (
                <button type="button" onClick={() => aiImportMutation.mutate(importImage)}
                  disabled={isAiLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                  {isAiLoading ? <Spinner /> : <Camera className="h-4 w-4" />}
                  {isAiLoading ? 'Analysing image…' : 'Import Workout'}
                </button>
              )}
            </div>
          )}

          {/* Preview */}
          {aiPreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{aiPreview.name}</p>
                  <p className="text-xs text-gray-500">{WORKOUT_TYPE_LABELS[aiPreview.workoutType]} · {aiPreview.exercises.length} exercises</p>
                </div>
                <button type="button" onClick={() => setAiPreview(null)}
                  className="text-xs text-gray-400 hover:text-gray-600">Redo</button>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {aiPreview.exercises.map((ex, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{ex.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {ex.sets} sets × {ex.reps} reps{ex.rpe ? ` · RPE ${ex.rpe}` : ''}
                        {ex.primaryMuscle ? ` · ${MUSCLE_GROUP_LABELS[ex.primaryMuscle as MuscleGroup] ?? ex.primaryMuscle}` : ''}
                      </p>
                      {ex.notes && <p className="text-xs text-gray-400 italic mt-0.5">{ex.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {populateMutation.isError && (
                <p className="text-xs text-red-500">{(populateMutation.error as Error)?.message || 'Failed to create workout.'}</p>
              )}

              <button type="button" onClick={() => populateMutation.mutate(aiPreview)}
                disabled={populateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 shadow-lg shadow-indigo-500/20">
                {populateMutation.isPending ? <Spinner /> : <Check className="h-4 w-4" />}
                {populateMutation.isPending ? 'Creating workout…' : 'Start This Workout'}
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
