import type { FastifyInstance } from 'fastify';
import type { CreateWorkoutInput, UpdateWorkoutInput, AddSetInput, UpdateSetInput } from '@fittrackr/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { checkAndUpdatePersonalRecords, getPRsForWorkout } from './personal-record.service.js';
import { tally, diffTally } from './workout-summary.js';

export async function createWorkout(
  fastify: FastifyInstance,
  userId: string,
  data: CreateWorkoutInput,
) {
  return fastify.prisma.workout.create({
    data: {
      userId,
      logDate: new Date(data.logDate + 'T00:00:00Z'),
      workoutType: data.workoutType,
      name: data.name ?? null,
      notes: data.notes ?? null,
      durationMin: data.durationMin ?? null,
      programId: data.programId ?? null,
      programWeek: data.programWeek ?? null,
      programDay: data.programDay ?? null,
    },
    include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } },
  });
}

export async function getWorkouts(
  fastify: FastifyInstance,
  userId: string,
  query: { from?: string; to?: string; page: number; limit: number },
) {
  const { from, to, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (from || to) {
    where.logDate = {};
    if (from) where.logDate.gte = new Date(from + 'T00:00:00Z');
    if (to) where.logDate.lte = new Date(to + 'T23:59:59Z');
  }

  const [items, total] = await Promise.all([
    fastify.prisma.workout.findMany({
      where,
      orderBy: { logDate: 'desc' },
      skip,
      take: limit,
      include: {
        sets: {
          where: { isWarmup: false },
          include: { exercise: { select: { id: true, name: true, primaryMuscle: true } } },
          orderBy: { setNumber: 'asc' },
        },
      },
    }),
    fastify.prisma.workout.count({ where }),
  ]);

  return { data: items, meta: { page, totalPages: Math.ceil(total / limit) || 1, total } };
}

export async function getWorkoutById(fastify: FastifyInstance, userId: string, id: string) {
  const workout = await fastify.prisma.workout.findUnique({
    where: { id },
    include: {
      sets: {
        include: { exercise: { select: { id: true, name: true, primaryMuscle: true, equipment: true } } },
        orderBy: { setNumber: 'asc' },
      },
    },
  });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');
  return workout;
}

export async function updateWorkout(
  fastify: FastifyInstance,
  userId: string,
  id: string,
  data: UpdateWorkoutInput,
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');

  return fastify.prisma.workout.update({
    where: { id },
    data: {
      ...(data.logDate !== undefined && { logDate: new Date(data.logDate + 'T00:00:00Z') }),
      ...(data.workoutType !== undefined && { workoutType: data.workoutType }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.durationMin !== undefined && { durationMin: data.durationMin }),
    },
    include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } },
  });
}

export async function deleteWorkout(fastify: FastifyInstance, userId: string, id: string) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');
  await fastify.prisma.workout.delete({ where: { id } });
}

export async function addSet(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  data: AddSetInput,
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id: workoutId } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');

  const set = await fastify.prisma.workoutSet.create({
    data: {
      workoutId,
      exerciseId: data.exerciseId,
      setNumber: data.setNumber,
      reps: data.reps ?? null,
      weightKg: data.weightKg ?? null,
      bodyweightKg: data.bodyweightKg ?? null,
      durationSec: data.durationSec ?? null,
      distanceM: data.distanceM ?? null,
      rpe: data.rpe ?? null,
      isWarmup: data.isWarmup ?? false,
      notes: data.notes ?? null,
    },
    include: { exercise: { select: { id: true, name: true, primaryMuscle: true, equipment: true } } },
  });

  if (!set.isWarmup) {
    await checkAndUpdatePersonalRecords(fastify, userId, set, workout.logDate);
  }

  // Maintain exerciseOrder — append this exercise if not already tracked
  if (!workout.exerciseOrder.includes(data.exerciseId)) {
    await fastify.prisma.workout.update({
      where: { id: workoutId },
      data: { exerciseOrder: [...workout.exerciseOrder, data.exerciseId] },
    });
  }

  return set;
}

export async function reorderExercises(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  exerciseOrder: string[],
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id: workoutId } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');
  return fastify.prisma.workout.update({ where: { id: workoutId }, data: { exerciseOrder } });
}

export async function updateSet(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  setId: string,
  data: UpdateSetInput,
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id: workoutId } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');

  const set = await fastify.prisma.workoutSet.findUnique({ where: { id: setId } });
  if (!set || set.workoutId !== workoutId) throw new NotFoundError('Set');

  const updated = await fastify.prisma.workoutSet.update({
    where: { id: setId },
    data: {
      ...(data.reps !== undefined && { reps: data.reps }),
      ...(data.weightKg !== undefined && { weightKg: data.weightKg }),
      ...(data.bodyweightKg !== undefined && { bodyweightKg: data.bodyweightKg }),
      ...(data.durationSec !== undefined && { durationSec: data.durationSec }),
      ...(data.distanceM !== undefined && { distanceM: data.distanceM }),
      ...(data.rpe !== undefined && { rpe: data.rpe }),
      ...(data.isWarmup !== undefined && { isWarmup: data.isWarmup }),
      ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
    include: { exercise: { select: { id: true, name: true, primaryMuscle: true, equipment: true } } },
  });

  // Re-check PRs on edit. Sets are created with the previous session's weight
  // and corrected afterwards, so only checking at creation meant a genuine PR
  // typed into an existing row was never recorded.
  if (data.weightKg !== undefined || data.reps !== undefined || data.isWarmup !== undefined) {
    await checkAndUpdatePersonalRecords(fastify, userId, updated, workout.logDate);
  }

  return updated;
}

export async function deleteSet(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  setId: string,
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id: workoutId } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');

  const set = await fastify.prisma.workoutSet.findUnique({ where: { id: setId } });
  if (!set || set.workoutId !== workoutId) throw new NotFoundError('Set');

  await fastify.prisma.workoutSet.delete({ where: { id: setId } });
}

/**
 * End-of-workout summary: session totals, a per-exercise comparison against the
 * most recent PREVIOUS session containing that exercise, and any PRs set today.
 *
 * "Previous" is per exercise, not per workout — if you last benched three
 * sessions ago, that is what today is compared against.
 */
export async function getWorkoutSummary(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
) {
  const workout = await getWorkoutById(fastify, userId, workoutId);

  const working = (workout.sets ?? []).filter((s) => !s.isWarmup);
  const exerciseIds = [...new Set(working.map((s) => s.exerciseId))];

  // One query for every prior appearance of today's exercises, newest first.
  const priorSets = exerciseIds.length
    ? await fastify.prisma.workoutSet.findMany({
        where: {
          exerciseId: { in: exerciseIds },
          isWarmup: false,
          workoutId: { not: workoutId },
          workout: { userId, logDate: { lte: workout.logDate } },
        },
        select: {
          exerciseId: true, reps: true, weightKg: true,
          workoutId: true, workout: { select: { logDate: true } },
        },
        orderBy: [{ workout: { logDate: 'desc' } }, { setNumber: 'asc' }],
      })
    : [];

  // Group each exercise's prior sets by the single most recent workout it appeared in.
  const previousByExercise = new Map<string, { logDate: Date; sets: typeof priorSets }>();
  for (const s of priorSets) {
    const seen = previousByExercise.get(s.exerciseId);
    if (!seen) {
      previousByExercise.set(s.exerciseId, { logDate: s.workout.logDate, sets: [s] });
    } else if (seen.sets[0].workoutId === s.workoutId) {
      seen.sets.push(s);
    }
    // Sets from older workouts are ignored — the list is already date-ordered.
  }

  const exercises = exerciseIds.map((exerciseId) => {
    const mine = working.filter((s) => s.exerciseId === exerciseId);
    const current = tally(mine);
    const prevEntry = previousByExercise.get(exerciseId);
    const previous = prevEntry ? tally(prevEntry.sets) : null;

    const delta = previous ? diffTally(current, previous) : null;

    return {
      exerciseId,
      name: mine[0]?.exercise?.name ?? 'Exercise',
      primaryMuscle: mine[0]?.exercise?.primaryMuscle ?? null,
      current,
      previous,
      previousDate: prevEntry ? prevEntry.logDate.toISOString().split('T')[0] : null,
      delta,
      isFirstTime: previous == null,
    };
  });

  const totals = tally(working);
  const prs = await getPRsForWorkout(fastify, userId, workoutId);

  return {
    workout: {
      id: workout.id,
      name: workout.name,
      workoutType: workout.workoutType,
      logDate: workout.logDate.toISOString().split('T')[0],
      durationMin: workout.durationMin,
    },
    totals: {
      exercises: exerciseIds.length,
      sets: totals.sets,
      totalReps: totals.totalReps,
      volumeKg: Math.round(totals.volumeKg),
      warmupSets: (workout.sets ?? []).length - working.length,
    },
    exercises,
    personalRecords: prs.map((p) => ({
      exerciseId: p.exerciseId,
      exerciseName: p.exercise?.name ?? 'Exercise',
      recordType: p.recordType,
      value: p.value,
    })),
  };
}

export async function getWeeklyVolume(
  fastify: FastifyInstance,
  userId: string,
  from: string,
  to: string,
) {
  const sets = await fastify.prisma.workoutSet.findMany({
    where: {
      workout: {
        userId,
        logDate: {
          gte: new Date(from + 'T00:00:00Z'),
          lte: new Date(to + 'T23:59:59Z'),
        },
      },
      isWarmup: false,
    },
    select: { reps: true, weightKg: true, exercise: { select: { primaryMuscle: true } } },
  });

  const volumeByMuscle: Record<string, number> = {};
  let totalWeightKg = 0;
  for (const set of sets) {
    const muscle = set.exercise.primaryMuscle;
    volumeByMuscle[muscle] = (volumeByMuscle[muscle] ?? 0) + 1;
    if (set.reps != null && set.weightKg != null) {
      totalWeightKg += set.reps * set.weightKg;
    }
  }

  return { volumeByMuscle, totalWeightKg: Math.round(totalWeightKg) };
}

export async function getWorkoutRange(
  fastify: FastifyInstance,
  userId: string,
  from: string,
  to: string,
) {
  return fastify.prisma.workout.findMany({
    where: {
      userId,
      logDate: {
        gte: new Date(from + 'T00:00:00Z'),
        lte: new Date(to + 'T23:59:59Z'),
      },
    },
    orderBy: { logDate: 'asc' },
    include: {
      _count: { select: { sets: true } },
    },
  });
}
