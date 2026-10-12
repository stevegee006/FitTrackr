import { z } from 'zod';

export const generateProgramSchema = z.object({
  durationWeeks: z.number().int().min(2).max(24),
  workoutsPerWeek: z.number().int().min(2).max(7),
  primaryGoal: z.enum(['STRENGTH', 'HYPERTROPHY', 'ENDURANCE', 'WEIGHT_LOSS', 'GENERAL_FITNESS']),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  availableEquipment: z.array(z.enum(['BARBELL', 'DUMBBELL', 'CABLE', 'MACHINE', 'BODYWEIGHT', 'KETTLEBELL', 'BANDS', 'OTHER'])).default([]),
  /**
   * Free-text guidance folded into the model prompt.
   *
   * 1000 was too tight to be useful: a real 8-week brief naming each week's
   * session ran to ~3,800 characters and was rejected. 5000 is about 1,250
   * tokens of prompt, which is affordable, and the field is still bounded so
   * it cannot be used to stuff the context.
   */
  preferences: z.string().max(5000).optional(),
});

export type GenerateProgramInput = z.infer<typeof generateProgramSchema>;
