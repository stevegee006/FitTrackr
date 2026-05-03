import type { ActivityLevel } from '../types/user.js';

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHTLY_ACTIVE: 1.375,
  MODERATELY_ACTIVE: 1.55,
  VERY_ACTIVE: 1.725,
  EXTREMELY_ACTIVE: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  SEDENTARY: 'Sedentary (little to no exercise)',
  LIGHTLY_ACTIVE: 'Lightly Active (1-3 days/week)',
  MODERATELY_ACTIVE: 'Moderately Active (3-5 days/week)',
  VERY_ACTIVE: 'Very Active (6-7 days/week)',
  EXTREMELY_ACTIVE: 'Extremely Active (athlete/physical job)',
};
