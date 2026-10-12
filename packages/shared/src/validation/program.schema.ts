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

/**
 * A declarative change to a generated program.
 *
 * Shared by the manual "switch exercise" control and (next) the AI asked to
 * modify a plan. The model emits these rather than rewriting `programData`,
 * so every change is bounded, previewable and applied by tested code — a
 * model handed the whole JSON returns a whole JSON, and silent damage to the
 * other seven weeks would be invisible.
 *
 * `weeks` omitted means every week, which is how people describe a program
 * change: "swap it for the pec deck".
 */
export const programEditSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('replaceExercise'),
    from: z.string().min(1).max(255),
    to: z.object({
      name: z.string().min(1).max(255),
      primaryMuscle: z.string().max(40).optional(),
      equipment: z.string().max(40).optional(),
      category: z.string().max(40).optional(),
    }),
    weeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
  }),
  z.object({
    op: z.literal('setExerciseFields'),
    name: z.string().min(1).max(255),
    sets: z.number().int().min(1).max(20).optional(),
    reps: z.string().max(40).optional(),
    rpe: z.number().min(1).max(10).optional(),
    notes: z.string().max(1000).optional(),
    weeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
  }),
  z.object({
    op: z.literal('removeExercise'),
    name: z.string().min(1).max(255),
    weeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
  }),
  z.object({
    op: z.literal('setWeekNote'),
    weekNumber: z.number().int().min(1).max(52),
    note: z.string().max(2000),
  }),
]);

/** Bounded so one request cannot rewrite a program beyond recognition. */
export const programEditsSchema = z.object({
  edits: z.array(programEditSchema).min(1).max(50),
});

export type ProgramEdit = z.infer<typeof programEditSchema>;

/** A plain-language instruction to change a program, e.g. "swap the cable fly for the pec deck". */
export const aiEditProgramSchema = z.object({
  instruction: z.string().min(3).max(1000),
});
