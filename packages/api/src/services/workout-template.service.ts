import type { FastifyInstance } from 'fastify';
import type { CreateWorkoutTemplateInput } from '@fittrackr/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

export async function createTemplate(
  fastify: FastifyInstance,
  userId: string,
  data: CreateWorkoutTemplateInput,
) {
  return fastify.prisma.workoutTemplate.create({
    data: {
      userId,
      name: data.name,
      workoutType: data.workoutType,
      templateData: data.templateData as any,
    },
  });
}

export async function getTemplates(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.workoutTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getTemplateById(fastify: FastifyInstance, userId: string, id: string) {
  const template = await fastify.prisma.workoutTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError('WorkoutTemplate');
  if (template.userId !== userId) throw new ForbiddenError('Not your template');
  return template;
}

export async function updateTemplate(
  fastify: FastifyInstance,
  userId: string,
  id: string,
  data: Partial<CreateWorkoutTemplateInput>,
) {
  const template = await fastify.prisma.workoutTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError('WorkoutTemplate');
  if (template.userId !== userId) throw new ForbiddenError('Not your template');

  return fastify.prisma.workoutTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.workoutType !== undefined && { workoutType: data.workoutType }),
      ...(data.templateData !== undefined && { templateData: data.templateData as any }),
    },
  });
}

export async function deleteTemplate(fastify: FastifyInstance, userId: string, id: string) {
  const template = await fastify.prisma.workoutTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError('WorkoutTemplate');
  if (template.userId !== userId) throw new ForbiddenError('Not your template');
  await fastify.prisma.workoutTemplate.delete({ where: { id } });
}
