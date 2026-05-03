import type { MuscleGroup } from '../types/exercise.js';

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  SHOULDERS: 'Shoulders',
  BICEPS: 'Biceps',
  TRICEPS: 'Triceps',
  FOREARMS: 'Forearms',
  QUADS: 'Quads',
  HAMSTRINGS: 'Hamstrings',
  GLUTES: 'Glutes',
  CALVES: 'Calves',
  CORE: 'Core',
  FULL_BODY: 'Full Body',
};

export const MUSCLE_GROUP_COLORS: Record<MuscleGroup, string> = {
  CHEST: '#ef4444',
  BACK: '#3b82f6',
  SHOULDERS: '#f59e0b',
  BICEPS: '#8b5cf6',
  TRICEPS: '#ec4899',
  FOREARMS: '#6366f1',
  QUADS: '#10b981',
  HAMSTRINGS: '#14b8a6',
  GLUTES: '#f97316',
  CALVES: '#84cc16',
  CORE: '#06b6d4',
  FULL_BODY: '#6b7280',
};

export const PRIMARY_MUSCLE_GROUPS: MuscleGroup[] = [
  'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CORE',
];
