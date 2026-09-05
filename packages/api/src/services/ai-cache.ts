import type { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';

/**
 * Durable cache for AI answers.
 *
 * Every coach feature spends one of the user's own API credits per call, and
 * the results were held only in TanStack Query's in-memory cache — so a page
 * reload, an hour of `gcTime`, or opening the app on another device threw them
 * away and the next look cost another call. Redis is already in the stack (the
 * wger lookup caches the same way), so the answers live there instead.
 *
 * Two flags, because "show me what you have" and "go and think" are different
 * requests and the endpoint must be able to do the first without doing the
 * second:
 *
 *  - `generate: false` — return a cached answer or nothing. This is what a page
 *    does on load: it costs no credits, so a stored review appears by itself
 *    rather than waiting behind a button the user has already pressed once.
 *  - `refresh: true` — ignore the cache and regenerate, overwriting it. This is
 *    the refresh control, and the ONLY thing that re-spends a credit on an
 *    answer that already exists.
 *
 * The TTL is deliberately long. The point is that an answer stays put until
 * the user asks for a new one; the trade is that a review of an in-progress
 * week keeps showing what was true when it was generated, which is why the
 * refresh control is on every card.
 */
export const AI_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AiCacheOptions {
  /** Produce a fresh answer when there is no cached one. */
  generate: boolean;
  /** Bypass and overwrite the cached answer. */
  refresh: boolean;
}

export interface AiCacheResult<T> {
  data: T | null;
  /** True when this came from Redis rather than the provider. */
  cached: boolean;
}

export async function cachedAi<T>(
  fastify: FastifyInstance,
  key: string,
  { generate, refresh }: AiCacheOptions,
  produce: () => Promise<T>,
): Promise<AiCacheResult<T>> {
  if (!refresh) {
    try {
      const hit = await fastify.redis.get(key);
      if (hit) return { data: JSON.parse(hit) as T, cached: true };
    } catch (err) {
      // A cache read must never be the reason a feature fails — fall through
      // and treat it as a miss, exactly as wger.service does.
      logger.warn({ key, err: (err as Error)?.message }, 'ai cache: read failed');
    }
  }

  if (!generate) return { data: null, cached: false };

  const fresh = await produce();

  try {
    await fastify.redis.set(key, JSON.stringify(fresh), 'EX', AI_CACHE_TTL_SECONDS);
  } catch (err) {
    // The answer is already paid for; returning it uncached beats failing.
    logger.warn({ key, err: (err as Error)?.message }, 'ai cache: write failed');
  }

  return { data: fresh, cached: false };
}

/** Namespaced so one user's answers can never be served to another. */
export const aiCacheKeys = {
  blockReview: (userId: string, days: number) => `coach:review:v1:${userId}:${days}`,
  weekReview: (userId: string, weekStart: string) => `coach:week:v1:${userId}:${weekStart}`,
  sessionReview: (userId: string, workoutId: string) => `coach:session:v1:${userId}:${workoutId}`,
  nextWeekPlan: (userId: string, weekStart: string) => `coach:plan:v1:${userId}:${weekStart}`,
};
