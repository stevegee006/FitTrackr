import type { FastifyInstance } from 'fastify';
import { generateTrainingGoalSchema } from '@fittrackr/shared';
import * as goalService from '../../services/training-goal.service.js';

export default async function trainingGoalRoutes(fastify: FastifyInstance) {
  fastify.get('/training-goals', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await goalService.getTrainingGoals(fastify, req.user.sub);
      return { data };
    },
  });

  fastify.get('/training-goals/active', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await goalService.getActiveTrainingGoal(fastify, req.user.sub);
      return { data };
    },
  });

  // PATCH /training-goals/:id/active — activate, or clear the targets entirely
  fastify.patch('/training-goals/:id/active', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const { isActive } = (req.body ?? {}) as { isActive?: boolean };
      const data = await goalService.setTrainingGoalActive(
        fastify, req.user.sub, id, isActive === true,
      );
      return { data };
    },
  });

  fastify.post('/training-goals/generate', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = generateTrainingGoalSchema.parse(req.body);
      const data = await goalService.generateTrainingGoal(fastify, req.user.sub, body);
      return reply.code(201).send({ data });
    },
  });
}
