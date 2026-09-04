import type { FastifyInstance } from 'fastify';
import type { CreateWorkoutInput, UpdateWorkoutInput, AddSetInput, UpdateSetInput, FinishWorkoutInput } from '@fittrackr/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { checkAndUpdatePersonalRecords, getPRsForWorkout, recomputePersonalRecords } from './personal-record.service.js';
import { tally, diffTally, performedSets } from './workout-summary.js';

/**
 * Ownership guard for the handful of routes that write sets with a raw
 * `updateMany` instead of going through a service function. Throws the same
 * errors the service functions do, so the error handler shapes it identically.
 */
export async function assertWorkoutOwner(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
) {
  const workout = await fastify.prisma.workout.findUnique({
    where: { id: workoutId },
    select: { userId: true },
  });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');
}

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

  // Recompute rather than compare: an edit can LOWER a value, and the upward-
  // only check could never retract a record set from a mistyped number.
  if (data.weightKg !== undefined || data.reps !== undefined || data.isWarmup !== undefined) {
    await recomputePersonalRecords(fastify, userId, updated.exerciseId);
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

  // The deleted set may have been the one holding a record.
  await recomputePersonalRecords(fastify, userId, set.exerciseId);
}

/**
 * Finalize a workout: stamp `completedAt` and, if the caller measured one,
 * store the duration.
 *
 * `completedAt` is server time and never taken from the request — a client
 * clock has already written nonsense into this table once (see the ~29.8
 * million minute duration in sharp edge #72).
 *
 * `durationMin` is only written when supplied. Finishing is now reachable on a
 * workout whose clock never ran in this browser, and the old behaviour —
 * always writing `max(1, elapsed/60)` — would silently replace a real
 * duration with 1 minute.
 */
export async function finishWorkout(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  data: FinishWorkoutInput,
) {
  await assertWorkoutOwner(fastify, userId, workoutId);

  return fastify.prisma.workout.update({
    where: { id: workoutId },
    data: {
      completedAt: new Date(),
      ...(data.durationMin != null && { durationMin: data.durationMin }),
    },
    include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } },
  });
}

/**
 * Reopen a finished workout so it can be logged into again.
 *
 * Finishing must not be a one-way door: the author finishes a session, notices
 * a missed set, and needs to add it. The duration is deliberately left alone —
 * reopening is not "unfinishing", and the recorded time is still the truth
 * until Finish measures a new one.
 */
export async function reopenWorkout(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
) {
  await assertWorkoutOwner(fastify, userId, workoutId);

  return fastify.prisma.workout.update({
    where: { id: workoutId },
    data: { completedAt: null },
    include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } },
  });
}

/**
 * Remove an exercise from a workout entirely — every set of it, in one request.
 *
 * Deleting a mis-added exercise used to mean tapping the trash on each set in
 * turn: N requests, N refetches, and the exercise only disappearing on the last
 * one. Doing it server-side also lets three things be handled that the
 * per-set path cannot:
 *
 *  - `exerciseOrder` is PRUNED here. Everywhere else that array is append-only
 *    (`addSet` adds, nothing removes), so it accumulates ids for exercises with
 *    no sets left and the frontend has to filter them out defensively. This is
 *    the one path that knows for certain the exercise is gone.
 *  - A superset group left with fewer than two exercises is dissolved. A group
 *    of one is not a superset, and the logger's round-based rest timer keys off
 *    group membership.
 *  - PRs are recomputed once at the end rather than once per deleted set.
 */
export async function deleteWorkoutExercise(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
  exerciseId: string,
) {
  const workout = await fastify.prisma.workout.findUnique({ where: { id: workoutId } });
  if (!workout) throw new NotFoundError('Workout');
  if (workout.userId !== userId) throw new ForbiddenError('Not your workout');

  const sets = await fastify.prisma.workoutSet.findMany({
    where: { workoutId, exerciseId },
    select: { id: true, supersetGroupId: true },
  });
  if (sets.length === 0) throw new NotFoundError('Exercise in this workout');

  const groupIds = [
    ...new Set(sets.map((s) => s.supersetGroupId).filter((g): g is string => g != null)),
  ];

  await fastify.prisma.$transaction(async (tx) => {
    await tx.workoutSet.deleteMany({ where: { workoutId, exerciseId } });

    await tx.workout.update({
      where: { id: workoutId },
      data: { exerciseOrder: workout.exerciseOrder.filter((e) => e !== exerciseId) },
    });

    for (const groupId of groupIds) {
      const remaining = await tx.workoutSet.findMany({
        where: { workoutId, supersetGroupId: groupId },
        select: { exerciseId: true },
      });
      if (new Set(remaining.map((r) => r.exerciseId)).size < 2) {
        await tx.workoutSet.updateMany({
          where: { workoutId, supersetGroupId: groupId },
          data: { supersetGroupId: null },
        });
      }
    }
  });

  // Outside the transaction, like deleteSet: this does its own writes and a
  // failure here must not roll back a deletion the user already saw succeed.
  await recomputePersonalRecords(fastify, userId, exerciseId);

  return { deletedSets: sets.length };
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
  // Only what was actually performed. Replayed prefill that was never ticked
  // used to be counted as work — see performedSets for the per-workout rule.
  const performed = performedSets(working);
  const exerciseIds = [...new Set(performed.map((s) => s.exerciseId))];

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
          durationSec: true, distanceM: true,
          // Needed so the "last time" side applies the same performed-vs-
          // prefilled rule the current side does.
          isCompleted: true,
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
    const mine = performed.filter((s) => s.exerciseId === exerciseId);
    const current = tally(mine);
    const prevEntry = previousByExercise.get(exerciseId);
    // The previous entry is a single workout's sets, so the same per-workout
    // rule applies to it directly.
    const previous = prevEntry ? tally(performedSets(prevEntry.sets)) : null;

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

  const totals = tally(performed);
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
      durationSec: totals.durationSec,
      distanceM: Math.round(totals.distanceM),
      warmupSets: (workout.sets ?? []).length - working.length,
      // Logged but never ticked. Surfaced rather than silently dropped, so the
      // recap explains why it shows fewer sets than the logger does — and so
      // "I forgot to tick them" is visible instead of looking like lost data.
      skippedSets: working.length - performed.length,
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
    select: {
      reps: true, weightKg: true, isCompleted: true, workoutId: true,
      exercise: { select: { primaryMuscle: true } },
    },
  });

  // Same performed-vs-prefilled rule as the recap, applied per workout — the
  // rings and the undertrained-muscle nudge counted replayed sets nobody did,
  // so the dashboard could report a muscle at target on work that never
  // happened. See performedSets for why the fallback is per workout.
  const byWorkout = new Map<string, typeof sets>();
  for (const s of sets) {
    const bucket = byWorkout.get(s.workoutId);
    if (bucket) bucket.push(s);
    else byWorkout.set(s.workoutId, [s]);
  }
  const performed = [...byWorkout.values()].flatMap((ws) => performedSets(ws));

  const volumeByMuscle: Record<string, number> = {};
  let totalWeightKg = 0;
  for (const set of performed) {
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
