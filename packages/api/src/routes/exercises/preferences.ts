import type { FastifyInstance } from 'fastify';
import { aiChatCompletion } from '../../services/ai-provider.service.js';

interface WorkoutSetSummary {
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  isWarmup: boolean;
}

interface WorkoutWithSets {
  id: string;
  logDate: Date;
  sets: WorkoutSetSummary[];
}

export default async function exercisePreferenceRoutes(fastify: FastifyInstance) {
  // GET /exercises/:exerciseId/preference
  fastify.get('/exercises/:exerciseId/preference', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.params as any;
      const userId = req.user.sub;

      const pref = await fastify.prisma.exercisePreference.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
        select: { repRangeMin: true, repRangeMax: true, targetSets: true },
      });

      return { data: pref ?? null };
    },
  });

  // PATCH /exercises/:exerciseId/preference
  fastify.patch('/exercises/:exerciseId/preference', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.params as any;
      const userId = req.user.sub;
      const body = req.body as {
        repRangeMin?: number | null;
        repRangeMax?: number | null;
        targetSets?: number | null;
      };

      const result = await fastify.prisma.exercisePreference.upsert({
        where: { userId_exerciseId: { userId, exerciseId } },
        update: body,
        create: { userId, exerciseId, ...body },
      });

      return { data: result };
    },
  });

  // GET /exercises/:exerciseId/last-set
  fastify.get('/exercises/:exerciseId/last-set', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.params as any;
      const { excludeWorkoutId } = req.query as any;
      const userId = req.user.sub;

      const whereClause: Record<string, any> = {
        exerciseId,
        isWarmup: false,
        workout: { userId },
      };

      if (excludeWorkoutId) {
        whereClause.workoutId = { not: excludeWorkoutId };
      }

      const set = await fastify.prisma.workoutSet.findFirst({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        select: { weightKg: true, reps: true, rpe: true },
      });

      return { data: set ?? null };
    },
  });

  // GET /exercises/:exerciseId/history
  fastify.get('/exercises/:exerciseId/history', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.params as any;
      const { limit: limitParam } = req.query as any;
      const userId = req.user.sub;

      const limit = Math.min(parseInt(limitParam ?? '8', 10) || 8, 20);

      const workouts = await fastify.prisma.workout.findMany({
        where: {
          userId,
          sets: { some: { exerciseId } },
        },
        orderBy: { logDate: 'desc' },
        take: limit,
        select: {
          id: true,
          logDate: true,
          sets: {
            where: { exerciseId },
            orderBy: { setNumber: 'asc' },
            select: {
              setNumber: true,
              reps: true,
              weightKg: true,
              rpe: true,
              isWarmup: true,
            },
          },
        },
      });

      return { data: (workouts as WorkoutWithSets[]).map((w) => ({ date: w.logDate, sets: w.sets })) };
    },
  });

  // POST /exercises/:exerciseId/ai-suggest
  fastify.post('/exercises/:exerciseId/ai-suggest', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { exerciseId } = req.params as any;
      const userId = req.user.sub;

      // Fetch last 6 sessions of history
      const workouts = await fastify.prisma.workout.findMany({
        where: {
          userId,
          sets: { some: { exerciseId } },
        },
        orderBy: { logDate: 'desc' },
        take: 6,
        select: {
          id: true,
          logDate: true,
          sets: {
            where: { exerciseId },
            orderBy: { setNumber: 'asc' },
            select: {
              setNumber: true,
              reps: true,
              weightKg: true,
              rpe: true,
              isWarmup: true,
            },
          },
        },
      });

      const history = (workouts as WorkoutWithSets[]).map((w) => ({ date: w.logDate, sets: w.sets }));

      // Fetch user's preference for this exercise
      const pref = await fastify.prisma.exercisePreference.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
        select: { repRangeMin: true, repRangeMax: true, targetSets: true },
      });

      // Fetch exercise name
      const exercise = await fastify.prisma.exercise.findUnique({
        where: { id: exerciseId },
        select: { name: true },
      });

      const exerciseName = exercise?.name ?? 'Unknown exercise';
      const repRangeMin = pref?.repRangeMin ?? null;
      const repRangeMax = pref?.repRangeMax ?? null;
      const targetSets = pref?.targetSets ?? null;

      const systemPrompt =
        'You are an expert strength and conditioning coach analyzing workout data to guide progressive overload. Given an athlete\'s recent workout history for a specific exercise, suggest the optimal target for their next session. Respond ONLY with valid JSON.';

      const historyLines = history
        .map((session: { date: Date; sets: WorkoutSetSummary[] }) => {
          const workingSets = session.sets
            .filter((s: WorkoutSetSummary) => !s.isWarmup)
            .map((s: WorkoutSetSummary) => `${s.reps}x${s.weightKg}kg`)
            .join(', ');
          return `${session.date.toISOString().split('T')[0]}: ${workingSets}`;
        })
        .join('\n');

      const userPrompt = `Exercise: ${exerciseName}
Rep range target: ${repRangeMin ?? '?'}-${repRangeMax ?? '?'} reps
Target sets: ${targetSets ?? 'not set'}

Recent history (newest first):
${historyLines}

Analyze the progression trend and provide a suggestion for the next session.`;

      try {
        const result = await aiChatCompletion(fastify, userId, systemPrompt, userPrompt, {
          tier: 'light',
          maxTokens: 500,
        });

        const parsed = JSON.parse(result.content);
        const validStrategies = ['increase_weight', 'increase_reps', 'maintain', 'deload'];
        const rawStrategy = String(parsed.strategy ?? '').toLowerCase().replace(/[\s-]+/g, '_');
        return {
          data: {
            strategy: validStrategies.includes(rawStrategy) ? rawStrategy : 'maintain',
            suggestion: parsed.suggestion ?? 'No suggestion available.',
            targetWeightKg: parsed.targetWeightKg ?? null,
            targetRepsRange: parsed.targetRepsRange ?? null,
          },
        };
      } catch (err: any) {
        return reply.code(503).send({
          error: {
            code: 'AI_UNAVAILABLE',
            message: 'Configure an AI provider in Settings to use this feature.',
          },
        });
      }
    },
  });
}
