import { z } from 'zod';

export const generateTrainingGoalSchema = z.object({
  primaryGoal: z.enum(['STRENGTH', 'HYPERTROPHY', 'ENDURANCE', 'WEIGHT_LOSS', 'GENERAL_FITNESS']),
  weeklyFrequency: z.number().int().min(1).max(7),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
});

export type GenerateTrainingGoalInput = z.infer<typeof generateTrainingGoalSchema>;
