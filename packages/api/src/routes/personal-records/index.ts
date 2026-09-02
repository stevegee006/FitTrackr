import type { FastifyInstance } from 'fastify';
import * as prService from '../../services/personal-record.service.js';

export default async function personalRecordRoutes(fastify: FastifyInstance) {
  fastify.get('/personal-records', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.query as any;
      const data = await prService.getPersonalRecords(fastify, req.user.sub, exerciseId);
      return { data };
    },
  });

  // POST /personal-records/recompute — rebuild records from the logged sets.
  // Repairs records stranded by the upward-only rule (e.g. a mistyped rep count
  // that was corrected afterwards).
  fastify.post('/personal-records/recompute', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = (req.body ?? {}) as { exerciseId?: string };
      const data = await prService.recomputePersonalRecords(fastify, req.user.sub, exerciseId);
      return { data };
    },
  });

  fastify.get('/personal-records/recent', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { limit = '5' } = req.query as any;
      const data = await prService.getRecentPRs(fastify, req.user.sub, parseInt(limit));
      return { data };
    },
  });
}
