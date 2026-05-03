import { z } from 'zod';

export const muscleGroupValues = ['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE', 'FULL_BODY'] as const;
export const equipmentValues = ['BARBELL', 'DUMBBELL', 'CABLE', 'MACHINE', 'BODYWEIGHT', 'KETTLEBELL', 'BANDS', 'OTHER'] as const;
export const exerciseCategoryValues = ['COMPOUND', 'ISOLATION', 'CARDIO', 'STRETCHING', 'OTHER'] as const;
export const exerciseSourceValues = ['WGER', 'MANUAL', 'AI_INGEST'] as const;

export const createExerciseSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(exerciseCategoryValues),
  primaryMuscle: z.enum(muscleGroupValues),
  secondaryMuscles: z.array(z.enum(muscleGroupValues)).default([]),
  equipment: z.enum(equipmentValues).default('BODYWEIGHT'),
  instructions: z.string().max(5000).nullish(),
  videoUrl: z.string().url().max(500).nullish(),
  imageUrl: z.string().url().max(500).nullish(),
});

export const updateExerciseSchema = createExerciseSchema.partial();

export const parsedExerciseSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(exerciseCategoryValues),
  primaryMuscle: z.enum(muscleGroupValues),
  secondaryMuscles: z.array(z.enum(muscleGroupValues)).default([]),
  equipment: z.enum(equipmentValues).default('BODYWEIGHT'),
  instructions: z.string().max(5000).nullable().default(null),
});

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
export type ParsedExerciseInput = z.infer<typeof parsedExerciseSchema>;
