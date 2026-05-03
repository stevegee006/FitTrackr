import type { FastifyInstance } from 'fastify';
import { createWorkoutTemplateSchema } from '@fittrackr/shared';
import * as templateService from '../../services/workout-template.service.js';

export default async function workoutTemplateRoutes(fastify: FastifyInstance) {
  fastify.get('/workout-templates', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await templateService.getTemplates(fastify, req.user.id);
      return { data };
    },
  });

  fastify.get('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await templateService.getTemplateById(fastify, req.user.id, id);
      return { data };
    },
  });

  fastify.post('/workout-templates', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = createWorkoutTemplateSchema.parse(req.body);
      const data = await templateService.createTemplate(fastify, req.user.id, body);
      return reply.code(201).send({ data });
    },
  });

  fastify.patch('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const body = createWorkoutTemplateSchema.partial().parse(req.body);
      const data = await templateService.updateTemplate(fastify, req.user.id, id, body);
      return { data };
    },
  });

  fastify.delete('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      await templateService.deleteTemplate(fastify, req.user.id, id);
      return reply.code(204).send();
    },
  });
}
