import type { FastifyInstance } from 'fastify';
import type { CreateExerciseInput, UpdateExerciseInput } from '@fittrackr/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

export async function createExercise(
  fastify: FastifyInstance,
  userId: string,
  data: CreateExerciseInput,
  isAdmin: boolean,
) {
  return fastify.prisma.exercise.create({
    data: {
      name: data.name,
      category: data.category,
      primaryMuscle: data.primaryMuscle,
      secondaryMuscles: data.secondaryMuscles ?? [],
      equipment: data.equipment ?? 'BODYWEIGHT',
      instructions: data.instructions ?? null,
      videoUrl: data.videoUrl ?? null,
      imageUrl: data.imageUrl ?? null,
      source: 'MANUAL',
      isCustom: !isAdmin,
      createdByUserId: isAdmin ? null : userId,
    },
  });
}

export async function getExercises(
  fastify: FastifyInstance,
  query: { search?: string; muscle?: string; equipment?: string; page: number; limit: number },
) {
  const { search, muscle, equipment, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (muscle) where.primaryMuscle = muscle;
  if (equipment) where.equipment = equipment;

  const [items, total] = await Promise.all([
    fastify.prisma.exercise.findMany({
      where,
      orderBy: [{ isCustom: 'asc' }, { name: 'asc' }],
      skip,
      take: limit,
    }),
    fastify.prisma.exercise.count({ where }),
  ]);

  return { data: items, meta: { page, totalPages: Math.ceil(total / limit) || 1, total } };
}

export async function getExerciseById(fastify: FastifyInstance, id: string) {
  const exercise = await fastify.prisma.exercise.findUnique({ where: { id } });
  if (!exercise) throw new NotFoundError('Exercise');
  return exercise;
}

export async function updateExercise(
  fastify: FastifyInstance,
  userId: string,
  id: string,
  data: UpdateExerciseInput,
  isAdmin: boolean,
) {
  const exercise = await fastify.prisma.exercise.findUnique({ where: { id } });
  if (!exercise) throw new NotFoundError('Exercise');
  if (!isAdmin && exercise.createdByUserId !== userId) throw new ForbiddenError('Not your exercise');

  return fastify.prisma.exercise.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.primaryMuscle !== undefined && { primaryMuscle: data.primaryMuscle }),
      ...(data.secondaryMuscles !== undefined && { secondaryMuscles: data.secondaryMuscles }),
      ...(data.equipment !== undefined && { equipment: data.equipment }),
      ...(data.instructions !== undefined && { instructions: data.instructions }),
      ...(data.videoUrl !== undefined && { videoUrl: data.videoUrl }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
    },
  });
}

export async function deleteExercise(
  fastify: FastifyInstance,
  userId: string,
  id: string,
  isAdmin: boolean,
) {
  const exercise = await fastify.prisma.exercise.findUnique({ where: { id } });
  if (!exercise) throw new NotFoundError('Exercise');
  if (!isAdmin && exercise.createdByUserId !== userId) throw new ForbiddenError('Not your exercise');
  await fastify.prisma.exercise.delete({ where: { id } });
}
