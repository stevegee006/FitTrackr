import type { FastifyInstance } from 'fastify';
import * as awardsService from '../../services/awards.service.js';

export default async function awardsRoutes(fastify: FastifyInstance) {
  fastify.get('/awards', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      // The client sends its local date so week boundaries match what the
      // dashboard streak shows; the server's UTC "today" can be a day off.
      const { today } = req.query as { today?: string };
      const day = /^\d{4}-\d{2}-\d{2}$/.test(today ?? '')
        ? today!
        : new Date().toISOString().slice(0, 10);
      const data = await awardsService.getAwards(fastify, req.user.sub, day);
      return { data };
    },
  });
}
