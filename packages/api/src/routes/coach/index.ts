import type { FastifyInstance } from 'fastify';
import * as coachService from '../../services/coach.service.js';

export default async function coachRoutes(fastify: FastifyInstance) {
  // GET /coach/review — AI review of the recent training block.
  // A GET because it has no side effects, which lets the client cache it and
  // avoid re-spending an AI call on every revisit.
  fastify.get('/coach/review', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { days } = req.query as any;
      const parsed = parseInt(days ?? '30', 10);
      const window = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 7), 120) : 30;
      const data = await coachService.getCoachReview(fastify, req.user.sub, window);
      return { data };
    },
  });
}
