import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as coachService from '../../services/coach.service.js';
import * as coachReviews from '../../services/coach-reviews.service.js';
import { applyNextWeekPlan } from '../../services/plan-apply.service.js';
import { ValidationError } from '../../utils/errors.js';
import { cachedAi, aiCacheKeys } from '../../services/ai-cache.js';

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


/**
 * `generate` / `refresh` from the query string.
 *
 * Default is generate=false: a bare GET is "show me what you have", which is
 * what every page issues on load and costs no AI credits. The button sends
 * generate=1 and the refresh control sends refresh=1.
 */
function cacheOpts(query: any) {
  const truthy = (v: unknown) => v === '1' || v === 'true';
  const refresh = truthy(query?.refresh);
  return { generate: refresh || truthy(query?.generate), refresh };
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
      const { data, cached } = await cachedAi(
        fastify,
        aiCacheKeys.blockReview(req.user.sub, window),
        cacheOpts(req.query),
        () => coachService.getCoachReview(fastify, req.user.sub, window),
      );
      return { data, cached };
    },
  });

  // GET /coach/week-review?weekStart=YYYY-MM-DD — the same review, scoped to
  // one calendar week and built from the weekly recap's own numbers.
  fastify.get('/coach/week-review', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { weekStart } = req.query as any;
      const week = parseWeekStart(weekStart);
      const { data, cached } = await cachedAi(
        fastify,
        aiCacheKeys.weekReview(req.user.sub, week),
        cacheOpts(req.query),
        () => coachReviews.getWeekReview(fastify, req.user.sub, week),
      );
      return { data, cached };
    },
  });

  // GET /coach/session-review/:workoutId — pointers on a single session.
  fastify.get('/coach/session-review/:workoutId', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { workoutId } = req.params as { workoutId: string };
      const { data, cached } = await cachedAi(
        fastify,
        aiCacheKeys.sessionReview(req.user.sub, workoutId),
        cacheOpts(req.query),
        () => coachReviews.getSessionReview(fastify, req.user.sub, workoutId),
      );
      return { data, cached };
    },
  });

  // GET /coach/next-week-plan?weekStart=YYYY-MM-DD — a plan for the week after
  // the one recapped. GET for the same reason as the review: no side effects,
  // so the client can hold it for the session instead of paying twice.
  fastify.get('/coach/next-week-plan', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { weekStart, focus } = req.query as any;
      // `focus` is the weekly review's conclusion, forwarded by the client when
      // it already has one, so the plan acts on the same advice rather than
      // being an independent second opinion. Bounded: it lands in a prompt.
      const focusHint = typeof focus === 'string' && focus.trim()
        ? focus.trim().slice(0, 400)
        : undefined;
      const week = parseWeekStart(weekStart);
      const { data, cached } = await cachedAi(
        fastify,
        aiCacheKeys.nextWeekPlan(req.user.sub, week),
        cacheOpts(req.query),
        () => coachService.getNextWeekPlan(fastify, req.user.sub, week, focusHint),
      );
      return { data, cached };
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
