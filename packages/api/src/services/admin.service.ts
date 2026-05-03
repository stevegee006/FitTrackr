import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors.js';

export async function getStats(fastify: FastifyInstance) {
  const [users, exercises, workouts, programs, trainingGoals] = await Promise.all([
    fastify.prisma.user.count(),
    fastify.prisma.exercise.count(),
    fastify.prisma.workout.count(),
    fastify.prisma.program.count(),
    fastify.prisma.trainingGoal.count(),
  ]);

  return { users, exercises, workouts, programs, trainingGoals };
}

export async function listUsers(
  fastify: FastifyInstance,
  page: number,
  limit: number,
  search?: string,
) {
  const skip = (page - 1) * limit;
  const where = search
    ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { displayName: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    fastify.prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        authProvider: true,
        isAdmin: true,
        createdAt: true,
        _count: {
          select: {
            workouts: true,
            programs: true,
            trainingGoals: true,
          },
        },
      },
    }),
    fastify.prisma.user.count({ where }),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function deleteUser(
  fastify: FastifyInstance,
  adminUserId: string,
  targetUserId: string,
) {
  if (adminUserId === targetUserId) {
    throw new ForbiddenError('Cannot delete your own account');
  }

  const user = await fastify.prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new NotFoundError('User');

  await fastify.prisma.user.delete({ where: { id: targetUserId } });
}

export async function listExercises(
  fastify: FastifyInstance,
  page: number,
  limit: number,
  search?: string,
) {
  const skip = (page - 1) * limit;
  const where: any = {};
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    fastify.prisma.exercise.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    fastify.prisma.exercise.count({ where }),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateExercise(
  fastify: FastifyInstance,
  exerciseId: string,
  data: {
    name?: string;
    category?: string;
    primaryMuscle?: string;
    secondaryMuscles?: string[];
    equipment?: string;
    instructions?: string | null;
    videoUrl?: string | null;
    imageUrl?: string | null;
  },
) {
  const item = await fastify.prisma.exercise.findUnique({ where: { id: exerciseId } });
  if (!item) throw new NotFoundError('Exercise');

  return fastify.prisma.exercise.update({
    where: { id: exerciseId },
    data: data as any,
  });
}

export async function deleteExercise(fastify: FastifyInstance, exerciseId: string) {
  const item = await fastify.prisma.exercise.findUnique({ where: { id: exerciseId } });
  if (!item) throw new NotFoundError('Exercise');
  await fastify.prisma.exercise.delete({ where: { id: exerciseId } });
}

export async function resetUserPassword(
  fastify: FastifyInstance,
  adminUserId: string,
  targetUserId: string,
) {
  if (adminUserId === targetUserId) {
    throw new ForbiddenError('Cannot reset your own password this way');
  }

  const user = await fastify.prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new NotFoundError('User');

  if (user.authProvider !== 'LOCAL') {
    throw new ValidationError('Cannot reset password for OAuth users');
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await fastify.prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash, mustChangePassword: true },
  });

  return { tempPassword };
}

export async function createUser(
  fastify: FastifyInstance,
  email: string,
  password: string,
  displayName?: string,
) {
  const existing = await fastify.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await fastify.prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: displayName ?? null,
      authProvider: 'LOCAL',
      isAdmin: false,
      mustChangePassword: true,
      profile: { create: {} },
      settings: { create: {} },
    },
    select: { id: true, email: true, displayName: true, isAdmin: true, createdAt: true },
  });

  return user;
}
