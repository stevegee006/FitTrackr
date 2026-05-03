import { z } from 'zod';

export const generateProgramSchema = z.object({
  durationWeeks: z.number().int().min(2).max(24),
  workoutsPerWeek: z.number().int().min(2).max(7),
  primaryGoal: z.enum(['STRENGTH', 'HYPERTROPHY', 'ENDURANCE', 'WEIGHT_LOSS', 'GENERAL_FITNESS']),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  availableEquipment: z.array(z.enum(['BARBELL', 'DUMBBELL', 'CABLE', 'MACHINE', 'BODYWEIGHT', 'KETTLEBELL', 'BANDS', 'OTHER'])).default([]),
  preferences: z.string().max(1000).optional(),
});

export type GenerateProgramInput = z.infer<typeof generateProgramSchema>;
