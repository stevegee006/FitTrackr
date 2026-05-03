import type { FastifyInstance } from 'fastify';
import { createWorkoutTemplateSchema } from '@fittrackr/shared';
import * as templateService from '../../services/workout-template.service.js';

export default async function workoutTemplateRoutes(fastify: FastifyInstance) {
  fastify.get('/workout-templates', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await templateService.getTemplates(fastify, req.user.sub);
      return { data };
    },
  });

  fastify.get('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await templateService.getTemplateById(fastify, req.user.sub, id);
      return { data };
    },
  });

  fastify.post('/workout-templates', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = createWorkoutTemplateSchema.parse(req.body);
      const data = await templateService.createTemplate(fastify, req.user.sub, body);
      return reply.code(201).send({ data });
    },
  });

  fastify.patch('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const body = createWorkoutTemplateSchema.partial().parse(req.body);
      const data = await templateService.updateTemplate(fastify, req.user.sub, id, body);
      return { data };
    },
  });

  fastify.delete('/workout-templates/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      await templateService.deleteTemplate(fastify, req.user.sub, id);
      return reply.code(204).send();
    },
  });
}
