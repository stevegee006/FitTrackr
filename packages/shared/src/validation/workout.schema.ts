import { z } from 'zod';

export const workoutTypeValues = ['PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY', 'CARDIO', 'CUSTOM'] as const;

export const createWorkoutSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workoutType: z.enum(workoutTypeValues),
  name: z.string().max(255).nullish(),
  notes: z.string().max(2000).nullish(),
  // Capped at 24h. A corrupt client clock once wrote ~29.8 million minutes.
  durationMin: z.number().int().positive().max(1440).nullish(),
  // Set when the session comes from a program day, so program adherence and
  // the program summary can be measured.
  programId: z.string().uuid().nullish(),
  programWeek: z.number().int().min(1).nullish(),
  programDay: z.number().int().min(1).max(7).nullish(),
});

export const updateWorkoutSchema = createWorkoutSchema.partial();

/**
 * Finish Workout. `durationMin` is OPTIONAL and omitting it leaves the stored
 * duration alone — finishing a session whose clock never ran in this browser
 * would otherwise overwrite a real duration with the reset clock's value.
 * `completedAt` is stamped by the server, never accepted from the client.
 */
export const finishWorkoutSchema = z.object({
  durationMin: z.number().int().positive().max(1440).nullish(),
});

/**
 * Measurements read back from HealthKit after the watch saves the session.
 *
 * Both nullable, because a workout logged without a watch has neither and must
 * not be recorded as zero. The bounds are sanity rails rather than physiology:
 * a resting-band heart rate or a five-figure calorie burn means the wrong
 * workout was matched, and writing it would corrupt the summary silently.
 */
export const workoutHealthSchema = z.object({
  avgHeartRateBpm: z.number().int().min(30).max(240).nullish(),
  activeEnergyKcal: z.number().int().min(0).max(10000).nullish(),
});

/**
 * A workout recorded elsewhere, handed over from HealthKit.
 *
 * The phone re-sends a rolling window on every app open rather than tracking
 * an anchor, so this must be safe to receive repeatedly — `externalId` is the
 * HKWorkout UUID and the write is an upsert. An anchor would be more
 * efficient and much less safe: advancing it before the POST succeeded would
 * lose workouts permanently, with nothing to notice it had happened.
 */
export const importHealthWorkoutSchema = z.object({
  externalId: z.string().min(1).max(64),
  /** Local date, YYYY-MM-DD, computed on the device so the day matches the watch. */
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(255),
  workoutType: z.enum(['PUSH', 'PULL', 'LEGS', 'FULL_BODY', 'UPPER', 'LOWER', 'CARDIO', 'CUSTOM']),
  durationMin: z.number().int().min(0).max(1440).nullish(),
  distanceM: z.number().min(0).max(1_000_000).nullish(),
  avgHeartRateBpm: z.number().int().min(30).max(240).nullish(),
  activeEnergyKcal: z.number().int().min(0).max(10000).nullish(),
  completedAt: z.string().datetime().nullish(),
});

export const importHealthWorkoutsSchema = z.object({
  workouts: z.array(importHealthWorkoutSchema).max(300),
});

export const addSetSchema = z.object({
  exerciseId: z.string().uuid(),
  setNumber: z.number().int().min(1),
  reps: z.number().int().min(0).nullish(),
  weightKg: z.number().min(0).nullish(),
  bodyweightKg: z.number().min(0).nullish(),
  durationSec: z.number().int().min(0).nullish(),
  distanceM: z.number().min(0).nullish(),
  rpe: z.number().min(1).max(10).nullish(),
  isWarmup: z.boolean().default(false),
  isCompleted: z.boolean().default(false),
  supersetGroupId: z.string().uuid().nullish(),
  notes: z.string().max(500).nullish(),
});

export const updateSetSchema = addSetSchema.omit({ exerciseId: true, setNumber: true }).partial();

/**
 * A value to carry across every not-yet-completed set of one exercise.
 *
 * Deliberately narrow. Only weight and reps make sense to apply in bulk —
 * RPE is a per-set observation, and completion is per-set by definition — so
 * the schema is written out rather than derived from `updateSetSchema`, which
 * would quietly widen the moment a field is added there.
 */
export const applyToSetsSchema = z.object({
  reps: z.number().int().min(0).nullish(),
  weightKg: z.number().min(0).nullish(),
});

export const createWorkoutTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  workoutType: z.enum(workoutTypeValues),
  templateData: z.object({
    exercises: z.array(z.object({
      exerciseId: z.string().uuid(),
      exerciseName: z.string(),
      sets: z.number().int().min(1),
      reps: z.number().int().min(1).optional(),
      weightKg: z.number().min(0).optional(),
      notes: z.string().max(500).optional(),
    })),
  }),
});

export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type UpdateWorkoutInput = z.infer<typeof updateWorkoutSchema>;
export type FinishWorkoutInput = z.infer<typeof finishWorkoutSchema>;
export type WorkoutHealthInput = z.infer<typeof workoutHealthSchema>;
export type ImportHealthWorkoutInput = z.infer<typeof importHealthWorkoutSchema>;
export type ImportHealthWorkoutsInput = z.infer<typeof importHealthWorkoutsSchema>;
export type AddSetInput = z.infer<typeof addSetSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
export type CreateWorkoutTemplateInput = z.infer<typeof createWorkoutTemplateSchema>;
