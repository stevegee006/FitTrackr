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
      const { limit: limitParam, excludeWorkoutId } = req.query as any;
      const userId = req.user.sub;

      const limit = Math.min(parseInt(limitParam ?? '8', 10) || 8, 20);

      const historyWhere: Record<string, any> = { userId, sets: { some: { exerciseId } } };
      if (excludeWorkoutId) historyWhere.id = { not: excludeWorkoutId };

      const workouts = await fastify.prisma.workout.findMany({
        where: historyWhere,
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
      const { excludeWorkoutId: excludeId } = req.query as any;
      const userId = req.user.sub;

      // Fetch last 6 sessions of history, excluding the current workout
      const aiWhere: Record<string, any> = { userId, sets: { some: { exerciseId } } };
      if (excludeId) aiWhere.id = { not: excludeId };

      const workouts = await fastify.prisma.workout.findMany({
        where: aiWhere,
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

      // Fetch user's preferred units so the AI can speak in the right unit
      const settings = await fastify.prisma.userSettings.findUnique({
        where: { userId },
        select: { preferredUnits: true },
      });
      const isImperial = settings?.preferredUnits === 'IMPERIAL';
      const unitLabel = isImperial ? 'lbs' : 'kg';
      const toDisplay = (kg: number) =>
        isImperial ? Math.round(kg * 2.20462 * 10) / 10 : kg;

      const systemPrompt = `You are an expert strength and conditioning coach. Analyze the athlete's workout history and provide specific, actionable progressive overload advice. You MUST respond with ONLY a valid JSON object containing ALL of these fields:
{
  "strategy": one of "increase_weight" | "increase_reps" | "maintain" | "deload",
  "suggestion": "2-3 sentences of specific coaching advice explaining what to do next session and why",
  "targetWeight${isImperial ? 'Lbs' : 'Kg'}": number or null,
  "targetRepsRange": "e.g. '5' or '8-10'" or null
}
The "suggestion" field MUST be a non-empty string with specific advice. Do not leave it empty.`;

      const historyLines = history
        .map((session: { date: Date; sets: WorkoutSetSummary[] }) => {
          const workingSets = session.sets
            .filter((s: WorkoutSetSummary) => !s.isWarmup && s.weightKg != null)
            .map((s: WorkoutSetSummary) => `${s.reps ?? '?'}×${toDisplay(s.weightKg!)}${unitLabel}`)
            .join(', ');
          return `${session.date.toISOString().split('T')[0]}: ${workingSets || '(no working sets)'}`;
        })
        .join('\n');

      const rangeStr = repRangeMin != null && repRangeMax != null
        ? `${repRangeMin}–${repRangeMax} reps`
        : repRangeMin != null ? `${repRangeMin}+ reps` : 'not set';

      const userPrompt = `Exercise: ${exerciseName}
Target rep range: ${rangeStr}
Target sets per session: ${targetSets ?? 'not set'}
Units: ${unitLabel}

Recent history (most recent first):
${historyLines || 'No history yet.'}

Based on this progression, what should the athlete aim for in their next session? Provide the JSON response now.`;

      try {
        const result = await aiChatCompletion(fastify, userId, systemPrompt, userPrompt, {
          tier: 'light',
          maxTokens: 600,
        });

        const parsed = JSON.parse(result.content);
        const validStrategies = ['increase_weight', 'increase_reps', 'maintain', 'deload'];
        const rawStrategy = String(parsed.strategy ?? '').toLowerCase().replace(/[\s-]+/g, '_');

        // Handle both targetWeightLbs and targetWeightKg field names from the AI
        const rawTargetWeight = parsed.targetWeightLbs ?? parsed.targetWeightKg ?? null;
        const targetWeightKg = rawTargetWeight != null
          ? (isImperial ? rawTargetWeight / 2.20462 : rawTargetWeight)
          : null;

        const suggestion = (parsed.suggestion && String(parsed.suggestion).trim())
          || 'No specific suggestion generated — try refreshing.';

        return {
          data: {
            strategy: validStrategies.includes(rawStrategy) ? rawStrategy : 'maintain',
            suggestion,
            targetWeightKg: targetWeightKg != null ? Math.round(targetWeightKg * 100) / 100 : null,
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
