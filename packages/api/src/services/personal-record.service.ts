import type { FastifyInstance } from 'fastify';

interface SetForPR {
  id: string;
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

/** A record actually beaten by a set, so callers can report it. */
export interface PrAchieved {
  recordType: 'MAX_WEIGHT' | 'MAX_REPS' | 'MAX_1RM';
  value: number;
  /** The record this replaced — null when it's the first ever for the exercise. */
  previous: number | null;
}

/**
 * Epley is only meaningful up to roughly 12 reps; past that it inflates badly
 * (a 30-rep set computes to 2x the working weight and would beat any genuine
 * heavy single). Above the cap we decline to estimate rather than fabricate.
 */
export const MAX_1RM_REPS = 12;

export function epley1RM(weightKg: number, reps: number): number {
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export async function checkAndUpdatePersonalRecords(
  fastify: FastifyInstance,
  userId: string,
  set: SetForPR,
  /**
   * The workout's logDate. PRs used to be stamped with the server's "today",
   * which mis-dated every back-dated workout and every CSV import.
   */
  achievedOn?: Date,
): Promise<PrAchieved[]> {
  if (set.isWarmup) return [];

  const achievedAt = achievedOn ?? new Date();

  const candidates: Array<{ recordType: PrAchieved['recordType']; value: number }> = [];

  if (set.weightKg != null && set.weightKg > 0) {
    candidates.push({ recordType: 'MAX_WEIGHT', value: set.weightKg });
  }
  if (set.reps != null && set.reps > 0) {
    candidates.push({ recordType: 'MAX_REPS', value: set.reps });
  }
  if (
    set.weightKg != null && set.reps != null &&
    set.weightKg > 0 && set.reps > 0 && set.reps <= MAX_1RM_REPS
  ) {
    candidates.push({ recordType: 'MAX_1RM', value: epley1RM(set.weightKg, set.reps) });
  }

  const achieved: PrAchieved[] = [];

  for (const { recordType, value } of candidates) {
    const key = { userId, exerciseId: set.exerciseId, recordType: recordType as any };
    const existing = await fastify.prisma.personalRecord.findUnique({
      where: { userId_exerciseId_recordType: key },
    });

    if (existing && value <= existing.value) continue;

    await fastify.prisma.personalRecord.upsert({
      where: { userId_exerciseId_recordType: key },
      create: { userId, exerciseId: set.exerciseId, recordType: recordType as any, value, setId: set.id, achievedAt },
      update: { value, setId: set.id, achievedAt },
    });

    achieved.push({ recordType, value, previous: existing?.value ?? null });
  }

  return achieved;
}

export async function getPersonalRecords(
  fastify: FastifyInstance,
  userId: string,
  exerciseId?: string,
) {
  return fastify.prisma.personalRecord.findMany({
    where: { userId, ...(exerciseId ? { exerciseId } : {}) },
    include: { exercise: { select: { id: true, name: true, primaryMuscle: true } } },
    orderBy: { achievedAt: 'desc' },
  });
}

export async function getRecentPRs(fastify: FastifyInstance, userId: string, limit = 5) {
  return fastify.prisma.personalRecord.findMany({
    where: { userId },
    include: { exercise: { select: { id: true, name: true } } },
    orderBy: { achievedAt: 'desc' },
    take: limit,
  });
}

/**
 * PRs whose source set belongs to this workout — i.e. records set during the
 * session. `setId` has no FK, so this is a manual id match; records later
 * beaten elsewhere simply won't be here, which is the desired behaviour.
 */
export async function getPRsForWorkout(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
) {
  const sets = await fastify.prisma.workoutSet.findMany({
    where: { workoutId },
    select: { id: true },
  });
  if (sets.length === 0) return [];

  return fastify.prisma.personalRecord.findMany({
    where: { userId, setId: { in: sets.map((s) => s.id) } },
    include: { exercise: { select: { id: true, name: true } } },
    orderBy: { value: 'desc' },
  });
}
