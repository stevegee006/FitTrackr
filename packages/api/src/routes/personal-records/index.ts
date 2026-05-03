import type { FastifyInstance } from 'fastify';
import * as prService from '../../services/personal-record.service.js';

export default async function personalRecordRoutes(fastify: FastifyInstance) {
  fastify.get('/personal-records', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.query as any;
      const data = await prService.getPersonalRecords(fastify, req.user.id, exerciseId);
      return { data };
    },
  });

  fastify.get('/personal-records/recent', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { limit = '5' } = req.query as any;
      const data = await prService.getRecentPRs(fastify, req.user.id, parseInt(limit));
      return { data };
    },
  });
}
