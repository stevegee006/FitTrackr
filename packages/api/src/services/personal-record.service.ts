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

/**
 * Rebuild personal records from the sets themselves.
 *
 * `checkAndUpdatePersonalRecords` only ever raises a record — by design, since
 * a normal set shouldn't clear your best. But that means a record set from a
 * MISTYPED value survives the correction forever: type 35 into the reps box,
 * fix it to 10, and "Most reps 35" is stuck. Editing or deleting the set that
 * produced a record therefore has to recompute rather than compare.
 *
 * Omit `exerciseId` to rebuild everything for the user.
 */
export async function recomputePersonalRecords(
  fastify: FastifyInstance,
  userId: string,
  exerciseId?: string,
) {
  const sets = await fastify.prisma.workoutSet.findMany({
    where: {
      isWarmup: false,
      workout: { userId },
      ...(exerciseId ? { exerciseId } : {}),
    },
    select: {
      id: true, exerciseId: true, reps: true, weightKg: true,
      workout: { select: { logDate: true } },
    },
  });

  type Best = { value: number; setId: string; achievedAt: Date };
  // exerciseId -> recordType -> best
  const best = new Map<string, Map<PrAchieved['recordType'], Best>>();

  const consider = (
    exId: string,
    recordType: PrAchieved['recordType'],
    value: number,
    setId: string,
    achievedAt: Date,
  ) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const byType = best.get(exId) ?? new Map<PrAchieved['recordType'], Best>();
    const cur = byType.get(recordType);
    if (!cur || value > cur.value) byType.set(recordType, { value, setId, achievedAt });
    best.set(exId, byType);
  };

  for (const s of sets) {
    const at = s.workout.logDate;
    if (s.weightKg != null && s.weightKg > 0) {
      consider(s.exerciseId, 'MAX_WEIGHT', s.weightKg, s.id, at);
    }
    if (s.reps != null && s.reps > 0) {
      consider(s.exerciseId, 'MAX_REPS', s.reps, s.id, at);
    }
    if (
      s.weightKg != null && s.reps != null &&
      s.weightKg > 0 && s.reps > 0 && s.reps <= MAX_1RM_REPS
    ) {
      consider(s.exerciseId, 'MAX_1RM', epley1RM(s.weightKg, s.reps), s.id, at);
    }
  }

  // Every exercise that currently HAS a record must be revisited too, or a
  // record whose supporting sets are all gone would survive the rebuild.
  const existing = await fastify.prisma.personalRecord.findMany({
    where: { userId, ...(exerciseId ? { exerciseId } : {}) },
    select: { id: true, exerciseId: true, recordType: true },
  });

  const touched = new Set<string>([...best.keys(), ...existing.map((e) => e.exerciseId)]);
  let written = 0;
  let removed = 0;

  for (const exId of touched) {
    const byType = best.get(exId) ?? new Map<PrAchieved['recordType'], Best>();
    for (const recordType of ['MAX_WEIGHT', 'MAX_REPS', 'MAX_1RM'] as const) {
      const key = { userId, exerciseId: exId, recordType: recordType as any };
      const b = byType.get(recordType);
      if (b) {
        await fastify.prisma.personalRecord.upsert({
          where: { userId_exerciseId_recordType: key },
          create: { userId, exerciseId: exId, recordType: recordType as any, value: b.value, setId: b.setId, achievedAt: b.achievedAt },
          update: { value: b.value, setId: b.setId, achievedAt: b.achievedAt },
        });
        written++;
      } else {
        const gone = await fastify.prisma.personalRecord.deleteMany({ where: key });
        removed += gone.count;
      }
    }
  }

  return { exercises: touched.size, written, removed };
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
