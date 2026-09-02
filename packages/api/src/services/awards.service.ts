import type { FastifyInstance } from 'fastify';
import {
  classifyLift, evaluateAwards, streakHistory,
  type LiftKey, type AwardResult, type StreakHistory,
} from './awards-rules.js';

export interface AwardsResponse {
  awards: AwardResult[];
  streaks: StreakHistory;
  bodyweightKg: number | null;
  /** Which logged exercise supplied each lift's best, for transparency. */
  liftSources: Partial<Record<LiftKey, { name: string; bestKg: number }>>;
}

export async function getAwards(
  fastify: FastifyInstance,
  userId: string,
  today: string,
): Promise<AwardsResponse> {
  // Best weight per exercise comes from the PR table, which is already
  // maintained (and recomputable) rather than re-scanning every set.
  const prs = await fastify.prisma.personalRecord.findMany({
    where: { userId, recordType: 'MAX_WEIGHT' },
    include: { exercise: { select: { name: true } } },
  });

  const bestByLift: Partial<Record<LiftKey, number>> = {};
  const liftSources: AwardsResponse['liftSources'] = {};
  for (const pr of prs) {
    const lift = classifyLift(pr.exercise?.name ?? '');
    if (!lift) continue;
    if (bestByLift[lift] == null || pr.value > bestByLift[lift]!) {
      bestByLift[lift] = pr.value;
      liftSources[lift] = { name: pr.exercise?.name ?? 'Exercise', bestKg: pr.value };
    }
  }

  // Bodyweight: latest measurement, falling back to the profile.
  const measurement = await fastify.prisma.bodyMeasurement.findFirst({
    where: { userId, weightKg: { not: null } },
    orderBy: { measuredAt: 'desc' },
    select: { weightKg: true },
  });
  const profile = await fastify.prisma.userProfile.findUnique({
    where: { userId },
    select: { weightKg: true, weeklyFrequency: true },
  });
  const bodyweightKg = measurement?.weightKg ?? profile?.weightKg ?? null;

  const goal = profile?.weeklyFrequency
    ?? (await fastify.prisma.trainingGoal.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { weeklyFrequency: true },
    }))?.weeklyFrequency
    ?? 3;

  const workouts = await fastify.prisma.workout.findMany({
    where: { userId },
    select: { logDate: true },
    orderBy: { logDate: 'asc' },
  });
  const dates = workouts.map((w) => w.logDate.toISOString().slice(0, 10));

  return {
    awards: evaluateAwards(bestByLift, bodyweightKg),
    streaks: streakHistory(dates, today, goal),
    bodyweightKg,
    liftSources,
  };
}
