import { z } from 'zod';

/**
 * The single source of truth for the muscle-group values in TypeScript —
 * `MuscleGroup` in types/exercise.ts is derived from this array, so the union
 * and the runtime validator cannot drift apart, and MUSCLE_GROUP_LABELS /
 * MUSCLE_GROUP_COLORS fail to compile until a new value is given both.
 *
 * The one place still to update by hand is the `MuscleGroup` enum in
 * prisma/schema.prisma, which Prisma owns. Postgres enums are additive only:
 * adding a value needs an `ALTER TYPE ... ADD VALUE` migration and REMOVING
 * one is not a migration you can write while any row still references it.
 * Order here is display order (see PRIMARY_MUSCLE_GROUPS), not the enum's.
 */
export const muscleGroupValues = [
  'CHEST', 'BACK', 'LATS', 'TRAPS', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS',
  'QUADS', 'HAMSTRINGS', 'GLUTES', 'ADDUCTORS', 'ABDUCTORS', 'CALVES',
  'CORE', 'OBLIQUES', 'FULL_BODY',
] as const;
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
