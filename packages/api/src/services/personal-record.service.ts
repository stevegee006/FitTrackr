import type { FastifyInstance } from 'fastify';

interface SetForPR {
  id: string;
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

export function epley1RM(weightKg: number, reps: number): number {
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export async function checkAndUpdatePersonalRecords(
  fastify: FastifyInstance,
  userId: string,
  set: SetForPR,
) {
  const today = new Date().toISOString().split('T')[0];
  const achievedAt = new Date(today + 'T00:00:00Z');

  const updates: Array<{ recordType: string; value: number }> = [];

  if (set.weightKg != null && set.weightKg > 0) {
    updates.push({ recordType: 'MAX_WEIGHT', value: set.weightKg });
  }

  if (set.reps != null && set.reps > 0) {
    updates.push({ recordType: 'MAX_REPS', value: set.reps });
  }

  if (set.weightKg != null && set.reps != null && set.weightKg > 0 && set.reps > 0) {
    updates.push({ recordType: 'MAX_1RM', value: epley1RM(set.weightKg, set.reps) });
  }

  for (const { recordType, value } of updates) {
    const existing = await fastify.prisma.personalRecord.findUnique({
      where: { userId_exerciseId_recordType: { userId, exerciseId: set.exerciseId, recordType: recordType as any } },
    });

    if (!existing || value > existing.value) {
      await fastify.prisma.personalRecord.upsert({
        where: { userId_exerciseId_recordType: { userId, exerciseId: set.exerciseId, recordType: recordType as any } },
        create: {
          userId,
          exerciseId: set.exerciseId,
          recordType: recordType as any,
          value,
          setId: set.id,
          achievedAt,
        },
        update: { value, setId: set.id, achievedAt },
      });
    }
  }
}

export async function getPersonalRecords(
  fastify: FastifyInstance,
  userId: string,
  exerciseId?: string,
) {
  return fastify.prisma.personalRecord.findMany({
    where: { userId, ...(exerciseId ? { exerciseId } : {}) },
    include: { exercise: { select: { id: true, name: true } } },
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
