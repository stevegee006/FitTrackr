import type { TrainingGoalType } from '../types/exercise.js';

export const TRAINING_GOAL_LABELS: Record<TrainingGoalType, string> = {
  STRENGTH: 'Build Strength',
  HYPERTROPHY: 'Build Muscle',
  ENDURANCE: 'Build Endurance',
  WEIGHT_LOSS: 'Lose Weight',
  GENERAL_FITNESS: 'General Fitness',
};
