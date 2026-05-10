import type { FastifyInstance } from 'fastify';
import type { CreateWorkoutInput, UpdateWorkoutInput, AddSetInput, UpdateSetInput } from '@fittrackr/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { checkAndUpdatePersonalRecords } from './personal-record.service.js';

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
    await checkAndUpdatePersonalRecords(fastify, userId, set);
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

  return fastify.prisma.workoutSet.update({
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
