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
        select: { repRangeMin: true, repRangeMax: true, targetSets: true, isCardio: true },
      });

      // The exercise's own category is the fallback when the user has never
      // toggled the mode by hand.
      const exercise = await fastify.prisma.exercise.findUnique({
        where: { id: exerciseId },
        select: { category: true },
      });

      return {
        data: {
          repRangeMin: pref?.repRangeMin ?? null,
          repRangeMax: pref?.repRangeMax ?? null,
          targetSets: pref?.targetSets ?? null,
          isCardio: pref?.isCardio ?? null,
          categoryIsCardio: exercise?.category === 'CARDIO',
        },
      };
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
        isCardio?: boolean | null;
      };

      // Map explicitly rather than spreading the request body into Prisma —
      // the previous `update: body` would write any column a caller named.
      const fields = {
        ...(body.repRangeMin !== undefined && { repRangeMin: body.repRangeMin }),
        ...(body.repRangeMax !== undefined && { repRangeMax: body.repRangeMax }),
        ...(body.targetSets !== undefined && { targetSets: body.targetSets }),
        ...(body.isCardio !== undefined && { isCardio: body.isCardio }),
      };

      const result = await fastify.prisma.exercisePreference.upsert({
        where: { userId_exerciseId: { userId, exerciseId } },
        update: fields,
        create: { userId, exerciseId, ...fields },
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

  // GET /exercises/:exerciseId/last-session
  // The whole set list from the most recent session containing this exercise,
  // so adding it to a workout can reproduce that session rather than dropping
  // in a single blank set.
  fastify.get('/exercises/:exerciseId/last-session', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { exerciseId } = req.params as any;
      const { excludeWorkoutId } = req.query as any;
      const userId = req.user.sub;

      const where: Record<string, any> = { userId, sets: { some: { exerciseId, isWarmup: false } } };
      if (excludeWorkoutId) where.id = { not: excludeWorkoutId };

      const workout = await fastify.prisma.workout.findFirst({
        where,
        orderBy: { logDate: 'desc' },
        select: {
          logDate: true,
          sets: {
            where: { exerciseId, isWarmup: false },
            orderBy: { setNumber: 'asc' },
            select: {
              setNumber: true, reps: true, weightKg: true, rpe: true,
              durationSec: true, distanceM: true,
            },
          },
        },
      });

      if (!workout || workout.sets.length === 0) return { data: null };
      return { data: { logDate: workout.logDate, sets: workout.sets } };
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
  "strategy": one of "increase_weight" | "increase_reps" | "increase_sets" | "maintain" | "deload",
  "suggestion": "2-3 sentences of specific coaching advice explaining what to do next session and why",
  "targetWeight${isImperial ? 'Lbs' : 'Kg'}": number or null,
  "targetRepsRange": "e.g. '5' or '8-10'" or null,
  "targetSets": number or null
}
The "suggestion" field MUST be a non-empty string with specific advice. Do not leave it empty.

Apply DOUBLE PROGRESSION. These rules are not optional:
- Reps climb within the target range at a fixed load. Once the athlete hits the
  TOP of the range on all working sets, ADD WEIGHT and reset reps to the BOTTOM
  of the range.
- Reps AT OR ABOVE the top of the range mean the load is TOO LIGHT. That is
  "increase_weight". Exceeding the rep range is a success, never a problem, and
  never a reason to deload or to reduce weight.
- Reps inside the range but below the top: "increase_reps" at the same load.
- SETS matter as much as reps. If the athlete is below their target set count,
  the first progression is "increase_sets" — get the volume back at the current
  load before adding weight. Adding load while short on sets trades volume for
  intensity without saying so.
- If set count FELL since the previous session, say so plainly even when reps
  rose: fewer sets at more reps can be less total work, not more.
- targetSets is the number of working sets to aim for next session. Repeat the
  athlete's configured target when they are already meeting it.
- "deload" is ONLY for genuine stalling or regression — performance declining
  across multiple sessions, or failing to reach the BOTTOM of the range at the
  current load. Never deload an athlete who is meeting or beating the range.
- "maintain" when the load changed very recently and needs another exposure.
- Weight jumps should be realistic: ${isImperial ? '5–10 lbs for compounds, 2.5–5 lbs for isolation' : '2.5–5 kg for compounds, 1–2.5 kg for isolation'}.
- targetWeight must never be BELOW the athlete's current working weight unless
  the strategy is genuinely "deload".
- targetRepsRange should normally stay inside the athlete's configured range.
- BODYWEIGHT exercises (pull-ups, chin-ups, dips, push-ups) log reps with no
  weight, shown as "N reps (bodyweight)". They are NOT missing data. Progress
  them by reps first; once the top of the range is beaten, advise added
  external load (weight belt, dumbbell between the feet) or a harder variation.
  targetWeight must be null for these unless the athlete already uses added
  load.`;

      const historyLines = history
        .map((session: { date: Date; sets: WorkoutSetSummary[] }) => {
          // Bodyweight work (pull-ups, dips, push-ups) has no weightKg. Filtering
          // on weight dropped every set, so the model was told "(no working
          // sets)" and had nothing to reason about.
          const workingSets = session.sets
            .filter((s: WorkoutSetSummary) => !s.isWarmup && (s.weightKg != null || (s.reps ?? 0) > 0))
            .map((s: WorkoutSetSummary) =>
              s.weightKg != null
                ? `${s.reps ?? '?'}×${toDisplay(s.weightKg)}${unitLabel}`
                : `${s.reps ?? '?'} reps (bodyweight)`,
            )
            .join(', ');
          // The count is stated, not left to be counted off the list. Sets are
          // a progression lever in their own right and a light-tier model
          // reading "12x65lbs, 12x65lbs, 12x65lbs" reasons about the reps and
          // ignores that there were three of them.
          const setCount = session.sets.filter(
            (s: WorkoutSetSummary) => !s.isWarmup && (s.weightKg != null || (s.reps ?? 0) > 0),
          ).length;
          const prefix = setCount > 0 ? `${setCount} working ${setCount === 1 ? 'set' : 'sets'} — ` : '';
          return `${session.date.toISOString().split('T')[0]}: ${prefix}${workingSets || '(no working sets)'}`;
        })
        .join('\n');

      const rangeStr = repRangeMin != null && repRangeMax != null
        ? `${repRangeMin}–${repRangeMax} reps`
        : repRangeMin != null ? `${repRangeMin}+ reps` : 'not set';

      // Read the most recent session against the rep range HERE rather than
      // leaving the model to infer the relationship. It previously read
      // "10 reps against a 6-8 target" as drifting off-plan and recommended a
      // deload, when exceeding the range means the load is too light.
      // Same rule as the history lines: a bodyweight set still counts.
      const lastWorking = (history[0]?.sets ?? []).filter(
        (s: WorkoutSetSummary) => !s.isWarmup && (s.reps ?? 0) > 0,
      );
      let rangeSignal = '';
      let setSignal = '';
      if (lastWorking.length > 0) {
        const reps = lastWorking.map((s: WorkoutSetSummary) => s.reps!);
        const minReps = Math.min(...reps);
        const maxReps = Math.max(...reps);
        const loaded = lastWorking.filter((s: WorkoutSetSummary) => s.weightKg != null);
        const topWeight = loaded.length
          ? Math.max(...loaded.map((s: WorkoutSetSummary) => toDisplay(s.weightKg!)))
          : null;
        const repsPart = minReps === maxReps ? `${minReps}` : `${minReps}–${maxReps}`;
        // Bodyweight exercises progress by reps (or added load), not by moving
        // a barbell number, so don't invent a weight to talk about.
        const at = topWeight != null
          ? `${repsPart} reps at ${topWeight}${unitLabel}`
          : `${repsPart} reps at bodyweight`;

        // ── Sets, analysed the same way reps are ──────────────────────────
        // Reps were computed here and sets were not, so a session that fell
        // from 4 sets to 3 read as pure rep progress and the advice was "add
        // weight" — while total volume had actually dropped. Sets are a
        // progression lever, and the same principle applies as for the rep
        // range (#61): when a decision is a rule, compute it, don't ask a
        // light-tier model to derive it from a list.
        const setCount = lastWorking.length;
        const prevWorking = (history[1]?.sets ?? []).filter(
          (s: WorkoutSetSummary) => !s.isWarmup && (s.reps ?? 0) > 0,
        );
        const prevSetCount = prevWorking.length;

        const setParts: string[] = [
          `${setCount} working ${setCount === 1 ? 'set' : 'sets'} in the most recent session${
            targetSets != null ? `, against a target of ${targetSets}` : ''
          }.`,
        ];
        if (targetSets != null && setCount < targetSets) {
          setParts.push(
            `That is BELOW target, so the first lever is getting back to ${targetSets} sets at the current load. Say this explicitly before recommending more weight.`,
          );
        } else if (targetSets != null && setCount > targetSets) {
          setParts.push(`That is ABOVE target — a good moment to convert the extra volume into load.`);
        }
        if (prevSetCount > 0 && setCount < prevSetCount) {
          setParts.push(
            `Set count DROPPED from ${prevSetCount} to ${setCount} since the session before, so total volume may have fallen even though reps rose. Mention it.`,
          );
        } else if (prevSetCount > 0 && setCount > prevSetCount) {
          setParts.push(`Set count ROSE from ${prevSetCount} to ${setCount}, which is progress in itself.`);
        }
        setSignal = `SETS: ${setParts.join(' ')}`;

        if (repRangeMax != null && minReps >= repRangeMax) {
          rangeSignal = topWeight != null
            ? `ANALYSIS: every working set in the most recent session hit ${at} — at or ABOVE the top of the ${rangeStr} target. The load is too light. Strategy must be "increase_weight": add load and reset reps to the bottom of the range. Do NOT deload and do NOT reduce the weight.`
            : `ANALYSIS: every working set in the most recent session hit ${at} — at or ABOVE the top of the ${rangeStr} target, unweighted. This is a BODYWEIGHT exercise, so progress by adding external load (weight belt, dumbbell between the feet) and resetting reps to the bottom of the range, or by advancing to a harder variation. Strategy "increase_weight". Do NOT deload.`;
        } else if (repRangeMin != null && maxReps < repRangeMin) {
          rangeSignal = `ANALYSIS: the most recent session topped out at ${at} — BELOW the bottom of the ${rangeStr} target, so the load may be too heavy. Hold the weight, or deload only if this has persisted across several sessions.`;
        } else if (repRangeMax != null) {
          rangeSignal = `ANALYSIS: the most recent session was ${at}, inside the ${rangeStr} target but not yet at the top on every set. Strategy should normally be "increase_reps" at the same load.`;
        }
      }

      const userPrompt = `Exercise: ${exerciseName}
Target rep range: ${rangeStr}
Target sets per session: ${targetSets ?? 'not set'}
Units: ${unitLabel}

Recent history (most recent first):
${historyLines || 'No history yet.'}
${rangeSignal ? `\n${rangeSignal}` : ''}${setSignal ? `\n${setSignal}` : ''}

Base the advice on BOTH the rep analysis and the set analysis above. Provide the JSON response now.`;

      try {
        const result = await aiChatCompletion(fastify, userId, systemPrompt, userPrompt, {
          tier: 'light',
          maxTokens: 600,
        });

        const parsed = JSON.parse(result.content);
        const validStrategies = ['increase_weight', 'increase_reps', 'increase_sets', 'maintain', 'deload'];
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
            // Bounded like every other model-supplied number.
            targetSets: Number.isFinite(Number(parsed.targetSets))
              ? Math.min(Math.max(Math.round(Number(parsed.targetSets)), 1), 10)
              : null,
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
