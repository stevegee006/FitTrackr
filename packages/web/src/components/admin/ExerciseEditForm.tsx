'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import {
  ALL_MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_COLORS,
  ALL_EQUIPMENT,
  EQUIPMENT_LABELS,
  ALL_EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_LABELS,
} from '@fittrackr/shared';
import type { Equipment, ExerciseCategory, MuscleGroup } from '@fittrackr/shared';
import { Loader2 } from 'lucide-react';

export interface EditableExercise {
  id: string;
  name: string;
  category: string;
  primaryMuscle: string;
  secondaryMuscles?: string[] | null;
  equipment: string;
}

interface Props {
  exercise: EditableExercise;
  onCancel: () => void;
  onSaved: () => void;
}

const selectCls =
  'w-full rounded-lg border border-gray-300 px-2 py-2 text-sm bg-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100';

const fieldLabelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1';

/**
 * Full editor for a library exercise — the admin panel previously offered only
 * a rename, because `WorkoutSet.exerciseId` does not cascade so a mistagged
 * exercise cannot simply be deleted and recreated once anything references it.
 * Renaming was enough for a typo; it was no help at all for the actual problem,
 * which was a machine hip adductor filed under HAMSTRINGS.
 *
 * Lives in its own file rather than being added to admin/page.tsx, which is
 * already ~1,270 lines holding a dozen components.
 */
export function ExerciseEditForm({ exercise, onCancel, onSaved }: Props) {
  const [name, setName] = useState(exercise.name);
  const [category, setCategory] = useState<ExerciseCategory>(exercise.category as ExerciseCategory);
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup>(exercise.primaryMuscle as MuscleGroup);
  const [equipment, setEquipment] = useState<Equipment>(exercise.equipment as Equipment);
  const [secondary, setSecondary] = useState<MuscleGroup[]>(
    ((exercise.secondaryMuscles ?? []) as MuscleGroup[]).filter((m) => ALL_MUSCLE_GROUPS.includes(m)),
  );
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/exercises/${exercise.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          category,
          primaryMuscle,
          // A muscle cannot be both primary and secondary — the server would
          // accept it and every per-muscle tally would then count it twice.
          secondaryMuscles: secondary.filter((m) => m !== primaryMuscle),
          equipment,
        }),
      }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (err: any) => setError(err?.message ?? 'Could not save the exercise.'),
  });

  const toggleSecondary = (m: MuscleGroup) =>
    setSecondary((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const canSave = name.trim().length > 0 && !saveMutation.isPending;

  return (
    <div className="space-y-3">
      <div>
        <label className={fieldLabelCls} htmlFor={`ex-name-${exercise.id}`}>Name</label>
        <input
          autoFocus
          id={`ex-name-${exercise.id}`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) saveMutation.mutate();
            if (e.key === 'Escape') onCancel();
          }}
          className={selectCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={fieldLabelCls} htmlFor={`ex-cat-${exercise.id}`}>Category</label>
          <select
            id={`ex-cat-${exercise.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value as ExerciseCategory)}
            className={selectCls}
          >
            {ALL_EXERCISE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{EXERCISE_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={fieldLabelCls} htmlFor={`ex-equip-${exercise.id}`}>Equipment</label>
          <select
            id={`ex-equip-${exercise.id}`}
            value={equipment}
            onChange={(e) => setEquipment(e.target.value as Equipment)}
            className={selectCls}
          >
            {ALL_EQUIPMENT.map((eq) => (
              <option key={eq} value={eq}>{EQUIPMENT_LABELS[eq]}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={fieldLabelCls} htmlFor={`ex-primary-${exercise.id}`}>Primary muscle</label>
        <select
          id={`ex-primary-${exercise.id}`}
          value={primaryMuscle}
          onChange={(e) => setPrimaryMuscle(e.target.value as MuscleGroup)}
          className={selectCls}
        >
          {ALL_MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>{MUSCLE_GROUP_LABELS[m]}</option>
          ))}
        </select>
      </div>

      <div>
        <span className={fieldLabelCls}>Secondary muscles</span>
        <div className="flex flex-wrap gap-1.5">
          {ALL_MUSCLE_GROUPS.filter((m) => m !== primaryMuscle).map((m) => {
            const on = secondary.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleSecondary(m)}
                aria-pressed={on}
                // min-h-[32px] so these are hittable one-handed; the admin panel
                // gets used on the phone too.
                className={`text-xs px-2.5 min-h-[32px] rounded-full border transition-colors ${
                  on
                    ? 'text-white border-transparent font-medium'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
                style={on ? { backgroundColor: MUSCLE_GROUP_COLORS[m] } : undefined}
              >
                {MUSCLE_GROUP_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!canSave}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
        >
          {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
