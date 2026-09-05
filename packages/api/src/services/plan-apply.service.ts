import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { dayOffsetFromLabel, repsFromString, claimOffset, type PlanDayInput } from './plan-apply.js';

export type { PlanDayInput };

const ymd = (d: Date) => d.toISOString().split('T')[0];

/**
 * Turn an AI next-week plan into real workouts on next week's dates.
 *
 * Two deliberate constraints:
 *
 *  1. **Only exercises that already exist in the library are used.** The plan
 *     is built from what the athlete actually trained, so almost everything
 *     matches by name; anything that does not is REPORTED rather than created.
 *     Auto-creating would let a model invent "Incline Cable Chest Fly (Slight
 *     Angle)" and permanently pollute the exercise list — and since
 *     `WorkoutSet.exerciseId` does not cascade, a junk exercise that gets used
 *     once cannot be deleted afterwards.
 *  2. **Sets are created unticked**, carrying the prescribed reps and load.
 *     That matches what adding an exercise already does (it replays the last
 *     session), and because unticked sets do not count as performed, a planned
 *     week that never happens will not inflate any tally.
 *
 * Not transactional across workouts on purpose: a partial application leaves
 * real, usable workouts behind, and the caller is told exactly what was
 * created. Rolling back a Wednesday because Friday failed would be worse.
 */

const WORKOUT_TYPES = new Set([
  'PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY', 'CARDIO', 'CUSTOM',
]);

export async function applyNextWeekPlan(
  fastify: FastifyInstance,
  userId: string,
  weekStart: string,
  days: PlanDayInput[],
) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ValidationError('The plan has no days to apply.');
  }

  const settings = await fastify.prisma.userSettings.findUnique({
    where: { userId },
    select: { preferredUnits: true },
  });
  const isImperial = settings?.preferredUnits === 'IMPERIAL';
  // `load` arrives in the athlete's display unit; kg is canonical in storage.
  const toKg = (load: number) => Math.round((isImperial ? load / 2.20462 : load) * 100) / 100;

  // The plan is for the week AFTER the one that was recapped.
  const nextMonday = new Date(weekStart + 'T00:00:00Z');
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

  // One lookup for every name in the plan, matched case-insensitively.
  const wantedNames = [...new Set(days.flatMap((d) => d.exercises.map((e) => e.name.trim())))];
  const library = await fastify.prisma.exercise.findMany({
    where: { OR: wantedNames.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })) },
    select: { id: true, name: true },
  });
  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e]));

  const created: Array<{ id: string; logDate: string; name: string; exercises: number; sets: number }> = [];
  const skipped: string[] = [];

  // Two days can resolve to the same offset — a plan with two days labelled
  // "Thu" is a real thing models produce — and silently stacking both onto one
  // date loses a session. Later collisions slide forward to the next free day
  // inside the week, and only give up if the whole week is taken.
  const usedOffsets = new Set<number>();

  for (const [i, day] of days.entries()) {
    const resolved = day.exercises
      .map((e) => ({ ...e, match: byName.get(e.name.trim().toLowerCase()) }))
      .filter((e) => {
        if (!e.match) {
          skipped.push(e.name);
          return false;
        }
        return true;
      });

    // A day whose every exercise is unknown would otherwise create an empty
    // workout the user has to go and delete. Checked BEFORE claiming a date,
    // so a skipped day does not consume a slot a later day could use.
    if (resolved.length === 0) continue;

    const offset = claimOffset(dayOffsetFromLabel(day.label, i), usedOffsets);
    if (offset == null) continue;
    const logDate = new Date(nextMonday);
    logDate.setUTCDate(logDate.getUTCDate() + offset);

    const workoutType = WORKOUT_TYPES.has(day.workoutType) ? day.workoutType : 'CUSTOM';
    const name = day.focus?.trim() ? day.focus.trim().slice(0, 255) : null;

    const workout = await fastify.prisma.workout.create({
      data: {
        userId,
        logDate,
        workoutType: workoutType as any,
        name,
        // exerciseOrder is maintained in application code and nothing else
        // populates it on create — set it here so the logger renders the plan
        // in the order the coach wrote it.
        exerciseOrder: resolved.map((e) => e.match!.id),
      },
    });

    let setNumber = 0;
    for (const e of resolved) {
      const reps = repsFromString(e.reps);
      const weightKg = e.load != null && e.load > 0 ? toKg(e.load) : null;
      const setCount = Math.min(Math.max(Math.round(e.sets) || 1, 1), 10);

      for (let n = 0; n < setCount; n++) {
        await fastify.prisma.workoutSet.create({
          data: {
            workoutId: workout.id,
            exerciseId: e.match!.id,
            setNumber: ++setNumber,
            reps,
            weightKg,
            isWarmup: false,
            // Unticked: planned, not performed.
            isCompleted: false,
          },
        });
      }
    }

    created.push({
      id: workout.id,
      logDate: ymd(logDate),
      name: name ?? workoutType,
      exercises: resolved.length,
      sets: setNumber,
    });
  }

  if (created.length === 0) {
    throw new NotFoundError('Matching exercises for this plan');
  }

  logger.info(
    { userId, weekStart, created: created.length, skipped: skipped.length },
    'next-week plan: applied',
  );

  // Duplicates are informative here — the same unmatched name across three
  // days is three sets the user is not getting — but the list is for display,
  // so collapse it.
  return { created, skipped: [...new Set(skipped)] };
}
