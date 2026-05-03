import type { WorkoutType } from '../types/exercise.js';

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  PUSH: 'Push',
  PULL: 'Pull',
  LEGS: 'Legs',
  UPPER: 'Upper Body',
  LOWER: 'Lower Body',
  FULL_BODY: 'Full Body',
  CARDIO: 'Cardio',
  CUSTOM: 'Custom',
};

export const WORKOUT_TYPE_COLORS: Record<WorkoutType, string> = {
  PUSH: '#ef4444',
  PULL: '#3b82f6',
  LEGS: '#10b981',
  UPPER: '#f59e0b',
  LOWER: '#8b5cf6',
  FULL_BODY: '#6366f1',
  CARDIO: '#ec4899',
  CUSTOM: '#6b7280',
};
