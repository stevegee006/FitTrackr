import type { Equipment, ExerciseCategory } from '../types/exercise.js';
import { equipmentValues, exerciseCategoryValues } from '../validation/exercise.schema.js';
import { MUSCLE_GROUP_LABELS } from './muscle-groups.js';

// Display labels for the two smaller exercise enums. These were being derived
// ad hoc at every render site with `value.toLowerCase().replace('_', ' ')`,
// which lower-cases proper nouns and only replaces the FIRST underscore — fine
// for today's values, wrong the moment one has two.
export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  BARBELL: 'Barbell',
  DUMBBELL: 'Dumbbell',
  CABLE: 'Cable',
  MACHINE: 'Machine',
  BODYWEIGHT: 'Bodyweight',
  KETTLEBELL: 'Kettlebell',
  BANDS: 'Bands',
  OTHER: 'Other',
};

export const EXERCISE_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  COMPOUND: 'Compound',
  ISOLATION: 'Isolation',
  CARDIO: 'Cardio',
  STRETCHING: 'Stretching',
  OTHER: 'Other',
};

/** Canonical dropdown order — the Zod arrays, which are the source of truth. */
export const ALL_EQUIPMENT: readonly Equipment[] = equipmentValues;
export const ALL_EXERCISE_CATEGORIES: readonly ExerciseCategory[] = exerciseCategoryValues;

/**
 * Label lookups for values that arrive as plain `string` — API rows are typed
 * loosely in several places, and a value the deployed database has but this
 * build's constants do not (a new enum member on a newer API) must render as
 * itself rather than "undefined". Prefer the Record lookups where the value is
 * already typed; use these at the API boundary.
 */
export function muscleGroupLabel(value: string | null | undefined): string {
  if (!value) return '';
  return (MUSCLE_GROUP_LABELS as Record<string, string>)[value] ?? value;
}

export function equipmentLabel(value: string | null | undefined): string {
  if (!value) return '';
  return (EQUIPMENT_LABELS as Record<string, string>)[value] ?? value;
}

export function exerciseCategoryLabel(value: string | null | undefined): string {
  if (!value) return '';
  return (EXERCISE_CATEGORY_LABELS as Record<string, string>)[value] ?? value;
}
