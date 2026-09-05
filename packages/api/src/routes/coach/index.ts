import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as coachService from '../../services/coach.service.js';
import * as coachReviews from '../../services/coach-reviews.service.js';
import { applyNextWeekPlan } from '../../services/plan-apply.service.js';
import { ValidationError } from '../../utils/errors.js';

/** The client supplies its own local Monday — see weekly-recap.service. */
function parseWeekStart(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('weekStart must be a YYYY-MM-DD date');
  }
  return value;
}

/**
 * The plan is echoed back to be applied rather than regenerated, so the user
 * gets exactly the week they just read. That makes it client-supplied input,
 * so it is validated like any other body — `applyNextWeekPlan` additionally
 * refuses to invent exercises that are not already in the library.
 */
const applyPlanSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.array(z.object({
    label: z.string().max(32),
    workoutType: z.string().max(32),
    focus: z.string().max(255).default(''),
    exercises: z.array(z.object({
      name: z.string().min(1).max(255),
      sets: z.number().int().min(1).max(10),
      reps: z.string().max(16),
      load: z.number().min(0).max(2000).nullable(),
    })).max(12),
  })).min(1).max(7),
});

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

  // GET /coach/week-review?weekStart=YYYY-MM-DD — the same review, scoped to
  // one calendar week and built from the weekly recap's own numbers.
  fastify.get('/coach/week-review', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { weekStart } = req.query as any;
      const data = await coachReviews.getWeekReview(fastify, req.user.sub, parseWeekStart(weekStart));
      return { data };
    },
  });

  // GET /coach/session-review/:workoutId — pointers on a single session.
  fastify.get('/coach/session-review/:workoutId', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { workoutId } = req.params as { workoutId: string };
      const data = await coachReviews.getSessionReview(fastify, req.user.sub, workoutId);
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

  // POST /coach/next-week-plan/apply — write the plan into real workouts on
  // next week's dates. The one route here that changes anything.
  fastify.post('/coach/next-week-plan/apply', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = applyPlanSchema.parse(req.body);
      const data = await applyNextWeekPlan(fastify, req.user.sub, body.weekStart, body.days);
      return reply.code(201).send({ data });
    },
  });
}
