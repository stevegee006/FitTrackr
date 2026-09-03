'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_COLORS,
  ALL_MUSCLE_GROUPS,
  ALL_EQUIPMENT,
  EQUIPMENT_LABELS,
  ALL_EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_LABELS,
} from '@fittrackr/shared';
import type { Exercise, MuscleGroup, ExerciseCategory, Equipment } from '@fittrackr/shared';
import { Search, Dumbbell, ChevronRight, Plus, X } from 'lucide-react';

// These three lists were hand-written copies of the enums and had already
// drifted — the equipment one was missing KETTLEBELL entirely, so a kettlebell
// exercise could not be created here at all. Driven off the shared arrays now,
// which are generated from the same values the API validates against.
const CATEGORY_OPTIONS: { value: ExerciseCategory; label: string }[] =
  ALL_EXERCISE_CATEGORIES.map((value) => ({ value, label: EXERCISE_CATEGORY_LABELS[value] }));

const MUSCLE_OPTIONS: { value: MuscleGroup; label: string }[] =
  ALL_MUSCLE_GROUPS.map((value) => ({ value, label: MUSCLE_GROUP_LABELS[value] }));

const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] =
  ALL_EQUIPMENT.map((value) => ({ value, label: EQUIPMENT_LABELS[value] }));

const fieldClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100';

interface CreateExerciseForm {
  name: string;
  category: ExerciseCategory;
  primaryMuscle: MuscleGroup;
  equipment: Equipment;
}

function CreateExerciseModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateExerciseForm>({
    name: '',
    category: 'COMPOUND',
    primaryMuscle: 'CHEST',
    equipment: 'BARBELL',
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: (body: CreateExerciseForm) =>
      apiFetch<{ data: Exercise }>('/exercises', {
        method: 'POST',
        body: JSON.stringify({ ...body, secondaryMuscles: [], isCustom: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    mutation.mutate(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Exercise</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Barbell Back Squat"
              className={fieldClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ExerciseCategory }))}
              className={fieldClass}
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Primary Muscle</label>
            <select
              value={form.primaryMuscle}
              onChange={(e) => setForm((f) => ({ ...f, primaryMuscle: e.target.value as MuscleGroup }))}
              className={fieldClass}
            >
              {MUSCLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Equipment</label>
            <select
              value={form.equipment}
              onChange={(e) => setForm((f) => ({ ...f, equipment: e.target.value as Equipment }))}
              className={fieldClass}
            >
              {EQUIPMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-500 dark:text-red-400">
              {mutation.error instanceof Error ? mutation.error.message : 'Something went wrong. Please try again.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Creating…' : 'Create Exercise'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ExercisesPage() {
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | ''>('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['exercises', query, muscleFilter],
    queryFn: () =>
      apiFetch<{ data: Exercise[]; meta: any }>(
        `/exercises?search=${encodeURIComponent(query)}&muscle=${muscleFilter}&limit=50`,
      ),
    staleTime: 30_000,
  });

  const exercises = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exercise Library</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Browse and filter exercises</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Exercise
        </button>
      </div>

      {showCreateModal && <CreateExerciseModal onClose={() => setShowCreateModal(false)} />}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="pl-9"
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CORE', 'CALVES'] as MuscleGroup[]).map(
          (m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMuscleFilter(muscleFilter === m ? '' : m)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                muscleFilter === m
                  ? 'text-white border-transparent'
                  : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400'
              }`}
              style={muscleFilter === m ? { backgroundColor: MUSCLE_GROUP_COLORS[m] } : {}}
            >
              {MUSCLE_GROUP_LABELS[m]}
            </button>
          ),
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {exercises.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No exercises found.</div>
          ) : (
            exercises.map((ex) => (
              <div key={ex.id} className="flex items-center gap-3 px-4 py-3">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: MUSCLE_GROUP_COLORS[ex.primaryMuscle] + '20' }}
                >
                  <Dumbbell className="h-4 w-4" style={{ color: MUSCLE_GROUP_COLORS[ex.primaryMuscle] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ex.name}</p>
                  <p className="text-xs text-gray-500">
                    {MUSCLE_GROUP_LABELS[ex.primaryMuscle]}
                    {ex.secondaryMuscles?.length > 0 && ` · ${ex.secondaryMuscles.slice(0, 2).map((m) => MUSCLE_GROUP_LABELS[m as MuscleGroup]).join(', ')}`}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 shrink-0">
                  {ex.equipment.toLowerCase().replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {data?.meta && (
        <p className="text-xs text-center text-gray-400">{data.meta.total} exercises in library</p>
      )}
    </div>
  );
}
