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
export type AddSetInput = z.infer<typeof addSetSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
export type CreateWorkoutTemplateInput = z.infer<typeof createWorkoutTemplateSchema>;
