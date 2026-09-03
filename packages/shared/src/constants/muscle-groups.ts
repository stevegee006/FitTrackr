import type { MuscleGroup } from '../types/exercise.js';
import { muscleGroupValues } from '../validation/exercise.schema.js';

// `Record<MuscleGroup, …>` is deliberate rather than `Partial<…>`: adding a
// value to muscleGroupValues breaks the build here until it has a label and a
// colour, which is the only thing stopping a new group from rendering as
// "undefined" in a chart legend.
export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  LATS: 'Lats',
  TRAPS: 'Traps',
  SHOULDERS: 'Shoulders',
  BICEPS: 'Biceps',
  TRICEPS: 'Triceps',
  FOREARMS: 'Forearms',
  QUADS: 'Quads',
  HAMSTRINGS: 'Hamstrings',
  GLUTES: 'Glutes',
  ADDUCTORS: 'Adductors',
  ABDUCTORS: 'Abductors',
  CALVES: 'Calves',
  CORE: 'Core',
  OBLIQUES: 'Obliques',
  FULL_BODY: 'Full Body',
};

// Every value distinct: these are chart series colours and the left border on
// each exercise card in the logger, so two groups sharing a hex is a real
// legibility bug, not a nitpick.
export const MUSCLE_GROUP_COLORS: Record<MuscleGroup, string> = {
  CHEST: '#ef4444',
  BACK: '#3b82f6',
  LATS: '#0ea5e9',
  TRAPS: '#facc15',
  SHOULDERS: '#f59e0b',
  BICEPS: '#8b5cf6',
  TRICEPS: '#ec4899',
  FOREARMS: '#6366f1',
  QUADS: '#10b981',
  HAMSTRINGS: '#14b8a6',
  GLUTES: '#f97316',
  ADDUCTORS: '#a855f7',
  ABDUCTORS: '#d946ef',
  CALVES: '#84cc16',
  CORE: '#06b6d4',
  OBLIQUES: '#f43f5e',
  FULL_BODY: '#6b7280',
};

/** Canonical display order for anything that lists every group (dropdowns). */
export const ALL_MUSCLE_GROUPS: readonly MuscleGroup[] = muscleGroupValues;

/**
 * The rows the trends volume chart always shows, trained or not.
 *
 * Deliberately not every group — a phone-width chart of 17 rows, most of them
 * empty, reads worse than 10. Anything omitted here still appears once it has
 * sets or a target (see the chart's row set), so a new muscle group does not
 * need to be added here to become visible.
 */
export const PRIMARY_MUSCLE_GROUPS: MuscleGroup[] = [
  'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE',
];
