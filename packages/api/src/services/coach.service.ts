import type { FastifyInstance } from 'fastify';
import { aiChatCompletion } from './ai-provider.service.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are an experienced strength coach reviewing an athlete's recent training log. Be specific, practical and honest — reference their actual numbers rather than giving generic advice.

Return ONLY valid JSON with this exact structure:
{
  "headline": "one sentence summarising the block",
  "wins": ["2-4 short specific positives, each referencing real numbers"],
  "concerns": ["0-3 short specific issues — omit anything you cannot support from the data"],
  "suggestions": [
    { "title": "short imperative", "detail": "1-2 sentences of concrete advice" }
  ],
  "focusNextWeek": "one sentence on what to prioritise next week"
}

Rules:
- 2-4 suggestions. Concrete and actionable ("add a second hamstring movement on
  lower days"), never vague ("train harder", "stay consistent").
- Cite the athlete's own numbers — sets per muscle, session count, weight
  changes — so the advice is clearly about them.
- Beating a rep range means ADD LOAD. Never advise a deload for an athlete who
  is progressing; reserve that for genuine stalling or regression.
- Bodyweight exercises log reps with no weight. That is not missing data.
- If a muscle group has very few sets, say so plainly and name it.
- If the data is thin (one or two sessions), say that honestly and keep the
  advice modest rather than inventing trends.
- Never give medical advice or diagnose injuries. Suggest seeing a professional
  if the athlete's notes mention pain.`;

interface CoachWindow {
  days: number;
  sessions: number;
  setsByMuscle: Record<string, number>;
  totalSets: number;
  totalVolumeKg: number;
  exercises: Array<{
    name: string;
    sessions: number;
    sets: number;
    firstTopKg: number | null;
    lastTopKg: number | null;
  }>;
  prs: Array<{ exercise: string; recordType: string; value: number }>;
  weeklyTargets: Record<string, number> | null;
}

/** Gather the window without any AI, so the page can show facts even if AI fails. */
export async function getCoachWindow(
  fastify: FastifyInstance,
  userId: string,
  days: number,
): Promise<CoachWindow> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);

  const workouts = await fastify.prisma.workout.findMany({
    where: { userId, logDate: { gte: since } },
    orderBy: { logDate: 'asc' },
    include: {
      sets: {
        where: { isWarmup: false },
        include: { exercise: { select: { id: true, name: true, primaryMuscle: true } } },
      },
    },
  });

  const setsByMuscle: Record<string, number> = {};
  let totalSets = 0;
  let totalVolumeKg = 0;

  // exerciseId → per-session top weights, in date order.
  const perExercise = new Map<string, { name: string; sets: number; tops: number[] }>();

  for (const w of workouts) {
    const sessionTop = new Map<string, number>();
    for (const s of w.sets) {
      totalSets += 1;
      if (s.weightKg != null && s.reps != null) totalVolumeKg += s.weightKg * s.reps;
      const muscle = s.exercise?.primaryMuscle;
      if (muscle) setsByMuscle[muscle] = (setsByMuscle[muscle] ?? 0) + 1;

      const entry = perExercise.get(s.exerciseId) ?? {
        name: s.exercise?.name ?? 'Exercise', sets: 0, tops: [],
      };
      entry.sets += 1;
      perExercise.set(s.exerciseId, entry);

      if (s.weightKg != null) {
        sessionTop.set(s.exerciseId, Math.max(sessionTop.get(s.exerciseId) ?? 0, s.weightKg));
      }
    }
    for (const [exId, top] of sessionTop) perExercise.get(exId)?.tops.push(top);
  }

  const exercises = [...perExercise.values()]
    .map((e) => ({
      name: e.name,
      sessions: e.tops.length,
      sets: e.sets,
      firstTopKg: e.tops.length ? e.tops[0] : null,
      lastTopKg: e.tops.length ? e.tops[e.tops.length - 1] : null,
    }))
    // Most-trained first, and cap the list so the prompt stays small.
    .sort((a, b) => b.sets - a.sets)
    .slice(0, 12);

  const prs = await fastify.prisma.personalRecord.findMany({
    where: { userId, achievedAt: { gte: since } },
    include: { exercise: { select: { name: true } } },
    orderBy: { achievedAt: 'desc' },
    take: 10,
  });

  const goal = await fastify.prisma.trainingGoal.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  const weeklyTargets =
    (goal?.volumeTargets as any)?.weeklySetTargets ?? null;

  return {
    days,
    sessions: workouts.length,
    setsByMuscle,
    totalSets,
    totalVolumeKg: Math.round(totalVolumeKg),
    exercises,
    prs: prs.map((p) => ({
      exercise: p.exercise?.name ?? 'Exercise',
      recordType: p.recordType,
      value: p.value,
    })),
    weeklyTargets,
  };
}

export async function getCoachReview(
  fastify: FastifyInstance,
  userId: string,
  days: number,
) {
  const window = await getCoachWindow(fastify, userId, days);

  if (window.sessions === 0) {
    // Nothing to analyse — don't spend an AI call to say "no data".
    throw new AppError(
      422,
      'NO_TRAINING_DATA',
      `No workouts logged in the last ${days} days, so there's nothing to review yet.`,
    );
  }

  const settings = await fastify.prisma.userSettings.findUnique({
    where: { userId },
    select: { preferredUnits: true },
  });
  const isImperial = settings?.preferredUnits === 'IMPERIAL';
  const unit = isImperial ? 'lbs' : 'kg';
  const conv = (kg: number) => (isImperial ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10);

  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });

  const muscleLines = Object.entries(window.setsByMuscle)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => {
      const target = window.weeklyTargets?.[m];
      const perWeek = Math.round((n / window.days) * 7 * 10) / 10;
      return target != null
        ? `${m}: ${n} sets (~${perWeek}/week, target ${target}/week)`
        : `${m}: ${n} sets (~${perWeek}/week)`;
    })
    .join('\n');

  const exerciseLines = window.exercises
    .map((e) => {
      const move = e.firstTopKg != null && e.lastTopKg != null
        ? `top ${conv(e.firstTopKg)}→${conv(e.lastTopKg)}${unit}`
        : 'bodyweight';
      return `${e.name}: ${e.sessions} sessions, ${e.sets} sets, ${move}`;
    })
    .join('\n');

  const prLines = window.prs.length
    ? window.prs
        .map((p) => `${p.exercise} ${p.recordType} ${p.recordType === 'MAX_REPS' ? `${p.value} reps` : `${conv(p.value)}${unit}`}`)
        .join('\n')
    : 'None.';

  const userPrompt = `Training review for the last ${window.days} days. Units: ${unit}.
${profile?.goal ? `Stated goal: ${profile.goal}.` : ''}
${profile?.weeklyFrequency ? `Intended frequency: ${profile.weeklyFrequency} sessions/week.` : ''}

Sessions: ${window.sessions} (~${Math.round((window.sessions / window.days) * 7 * 10) / 10}/week)
Total working sets: ${window.totalSets}
Total volume: ${conv(window.totalVolumeKg)} ${unit}

Sets per muscle group:
${muscleLines || 'None recorded.'}

Most-trained exercises:
${exerciseLines || 'None recorded.'}

Personal records set in this window:
${prLines}

Review this block and return the JSON now.`;

  try {
    const result = await aiChatCompletion(fastify, userId, SYSTEM_PROMPT, userPrompt, {
      tier: 'heavy',
      maxTokens: 1400,
      temperature: 0.4,
    });

    const parsed = JSON.parse(result.content);
    return {
      window,
      model: result.model,
      review: {
        headline: String(parsed.headline ?? '').trim() || 'Here is how the last block looked.',
        wins: Array.isArray(parsed.wins) ? parsed.wins.map(String) : [],
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions
              .filter((x: any) => x && (x.title || x.detail))
              .map((x: any) => ({ title: String(x.title ?? ''), detail: String(x.detail ?? '') }))
          : [],
        focusNextWeek: String(parsed.focusNextWeek ?? '').trim() || null,
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err: (err as Error)?.message }, 'Coach review failed to parse');
    throw new AppError(
      502,
      'AI_INVALID_RESPONSE',
      'The coach returned something unreadable. Please try again.',
    );
  }
}
