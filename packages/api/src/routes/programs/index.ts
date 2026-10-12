import type { FastifyInstance } from 'fastify';
import { generateProgramSchema, programEditsSchema, aiEditProgramSchema } from '@fittrackr/shared';
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

  // POST /programs/:id/ai-edit — turn a plain-language instruction into edit
  // operations. PREVIEW ONLY: nothing is saved. The client shows what would
  // change and posts the operations to /edits if the athlete agrees, so a
  // model that misunderstands costs a glance rather than a program.
  fastify.post('/programs/:id/ai-edit', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      const body = aiEditProgramSchema.parse(req.body);
      const data = await programService.aiEditProgram(fastify, req.user.sub, id, body.instruction);
      return reply.send({ data });
    },
  });

  // PATCH /programs/:id/edits — apply declarative changes to a generated
  // program. Programs were immutable, so swapping one exercise meant
  // regenerating the block and losing everything else the model got right.
  fastify.patch('/programs/:id/edits', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      const body = programEditsSchema.parse(req.body);
      const data = await programService.editProgram(fastify, req.user.sub, id, body.edits);
      return reply.send({ data });
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
