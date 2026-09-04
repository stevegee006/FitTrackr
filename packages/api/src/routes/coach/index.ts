import type { FastifyInstance } from 'fastify';
import * as coachService from '../../services/coach.service.js';
import { ValidationError } from '../../utils/errors.js';

/** The client supplies its own local Monday — see weekly-recap.service. */
function parseWeekStart(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('weekStart must be a YYYY-MM-DD date');
  }
  return value;
}

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

  // GET /coach/next-week-plan?weekStart=YYYY-MM-DD — a plan for the week after
  // the one recapped. GET for the same reason as the review: no side effects,
  // so the client can hold it for the session instead of paying twice.
  fastify.get('/coach/next-week-plan', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { weekStart } = req.query as any;
      const data = await coachService.getNextWeekPlan(fastify, req.user.sub, parseWeekStart(weekStart));
      return { data };
    },
  });
}
