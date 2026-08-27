import type { FastifyInstance } from 'fastify';
import { generateProgramSchema } from '@fittrackr/shared';
import * as programService from '../../services/program.service.js';

export default async function programRoutes(fastify: FastifyInstance) {
  fastify.get('/programs', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await programService.getPrograms(fastify, req.user.sub);
      return { data };
    },
  });

  fastify.get('/programs/:id/summary', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await programService.getProgramSummary(fastify, req.user.sub, id);
      return { data };
    },
  });

  fastify.get('/programs/active', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const data = await programService.getActiveProgram(fastify, req.user.sub);
      return { data };
    },
  });

  fastify.post('/programs/generate', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = generateProgramSchema.parse(req.body);
      const data = await programService.generateProgram(fastify, req.user.sub, body);
      return reply.code(201).send({ data });
    },
  });

  fastify.delete('/programs/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      await programService.deleteProgram(fastify, req.user.sub, id);
      return reply.code(204).send();
    },
  });
}
