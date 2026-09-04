import type { FastifyInstance } from 'fastify';
import { aiChatCompletion } from './ai-provider.service.js';
import { performedSets } from './workout-summary.js';
import { getWeeklyRecap } from './weekly-recap.service.js';
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

const PLAN_SYSTEM_PROMPT = `You are an experienced strength coach writing next week's training plan for an athlete, based on the week they just finished. Be specific and reference their actual numbers.

Return ONLY valid JSON with this exact structure:
{
  "focus": "one sentence on the theme of next week",
  "days": [
    {
      "label": "Mon",
      "workoutType": "PUSH",
      "focus": "short phrase",
      "keyExercises": [
        { "name": "Barbell Bench Press", "prescription": "4x6-8 @ 165 lbs", "why": "short reason" }
      ]
    }
  ],
  "adjustments": ["1-4 short specific changes from last week, each citing a real number"],
  "cautions": ["0-2 things to watch — omit if there is nothing honest to say"]
}

Rules:
- Plan exactly the number of sessions the athlete trains per week. If that is
  unknown, match the session count they actually did last week.
- 3-4 keyExercises per day, not a full session listing. Prescribe load in the
  athlete's units, based on what they actually lifted.
- Keep every string SHORT. "why" is at most 12 words; omit it rather than pad
  it. The whole response must stay well under 1000 tokens — a long reply is
  slower than the gateway in front of this API will wait for.
- Progress an exercise that BEAT its rep range by adding load. Beating a range
  is never a reason to deload; reserve that for genuine stalling or regression.
- Bodyweight work logs reps with no weight — progress it by reps, then by a
  harder variation. That is not missing data.
- Name an undertrained muscle group explicitly if the sets-per-muscle data
  shows one, and put work for it in the plan.
- If last week was thin (one or two sessions), say so in "focus" and plan
  modestly rather than inventing a peak week.
- workoutType must be one of: PUSH, PULL, LEGS, UPPER, LOWER, FULL_BODY, CARDIO, CUSTOM
- Never give medical advice or diagnose injuries.`;

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
    // Replayed prefill nobody ticked is not training the coach should reason
    // about — it would read as extra volume that was never done.
    for (const s of performedSets(w.sets)) {
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

/**
 * A plan for the week AFTER the one being recapped.
 *
 * Deliberately built from the weekly recap's own numbers rather than a second
 * gathering pass, so the plan cites exactly what the page above it shows. As
 * with the review, the facts are assembled with no AI first and an empty week
 * is refused before spending a call.
 */
export async function getNextWeekPlan(
  fastify: FastifyInstance,
  userId: string,
  weekStart: string,
) {
  const recap = await getWeeklyRecap(fastify, userId, weekStart);

  if (recap.totals.sessions === 0) {
    throw new AppError(
      422,
      'NO_TRAINING_DATA',
      'No workouts logged that week, so there is nothing to build a plan from.',
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

  // Rep-range targets are a deliberate setting, and the model needs them to
  // apply double progression rather than inventing its own rule (#61).
  const prefs = await fastify.prisma.exercisePreference.findMany({
    where: { userId },
    select: { exerciseId: true, repRangeMin: true, repRangeMax: true, targetSets: true },
  });
  const prefByExercise = new Map(prefs.map((p) => [p.exerciseId, p]));

  const muscleLines = Object.entries(recap.setsByMuscle)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => {
      const target = recap.weeklyTargets?.[m];
      return target != null ? `${m}: ${n} sets (target ${target})` : `${m}: ${n} sets`;
    })
    .join('\n');

  // Any muscle with a target and no work at all is invisible in setsByMuscle,
  // so name it explicitly — otherwise the model cannot see what is missing.
  const missing = Object.entries(recap.weeklyTargets ?? {})
    .filter(([m, target]) => (target ?? 0) > 0 && !(recap.setsByMuscle[m] > 0))
    .map(([m, target]) => `${m}: 0 sets (target ${target})`)
    .join('\n');

  const exerciseLines = recap.exercises
    .slice(0, 10)
    .map((e) => {
      // Time/distance first — telling the model a treadmill walk was a
      // "bodyweight" lift invites it to prescribe reps for it (#74).
      const move = e.durationSec > 0 || e.distanceM > 0
        ? [
            e.durationSec > 0 ? `${Math.round(e.durationSec / 60)} min` : null,
            e.distanceM > 0
              ? isImperial
                ? `${(e.distanceM / 1609.344).toFixed(2)} mi`
                : `${(e.distanceM / 1000).toFixed(2)} km`
              : null,
          ].filter(Boolean).join(', ')
        : e.firstTopKg != null && e.lastTopKg != null
          ? e.firstTopKg === e.lastTopKg
            ? `top ${conv(e.lastTopKg)}${unit}`
            : `top ${conv(e.firstTopKg)}→${conv(e.lastTopKg)}${unit}`
          : 'bodyweight';
      // The configured rep range, stated rather than left to be inferred —
      // asking a model to derive the progression rule is how it once
      // recommended a deload for BEATING the range (#61).
      const pref = prefByExercise.get(e.exerciseId);
      const range = pref?.repRangeMin != null && pref?.repRangeMax != null
        ? `, target ${pref.repRangeMin}-${pref.repRangeMax} reps${pref.targetSets ? ` x${pref.targetSets} sets` : ''}`
        : '';
      return `${e.name}: ${e.sets} sets over ${e.sessions} session(s), ${move}${range}`;
    })
    .join('\n');

  const prLines = recap.personalRecords.length
    ? recap.personalRecords
        .map((p) => `${p.exerciseName} ${p.recordType} ${p.recordType === 'MAX_REPS' ? `${p.value} reps` : `${conv(p.value)}${unit}`}`)
        .join('\n')
    : 'None.';

  const sessionLines = recap.sessions
    .map((s) => `${s.logDate} ${s.workoutType}${s.name ? ` "${s.name}"` : ''}: ${s.sets} sets${s.durationMin ? `, ${s.durationMin} min` : ''}`)
    .join('\n');

  const userPrompt = `Plan next week's training. The week just finished ran ${recap.weekStart} to ${recap.weekEnd}. Units: ${unit}.
${profile?.goal ? `Stated goal: ${profile.goal}.` : ''}
${recap.goal.weeklyFrequency ? `Trains ${recap.goal.weeklyFrequency} days/week (trained ${recap.goal.trainingDays} last week).` : ''}

Sessions last week (${recap.totals.sessions}):
${sessionLines || 'None.'}

Totals: ${recap.totals.sets} working sets, ${recap.totals.totalReps} reps, ${conv(recap.totals.volumeKg)} ${unit} volume${recap.totals.trainingMin ? `, ${recap.totals.trainingMin} min under the bar` : ''}.
Versus the week before: ${recap.previous.sessions} sessions, ${recap.previous.sets} sets, ${conv(recap.previous.volumeKg)} ${unit}.

Sets per muscle group:
${muscleLines || 'None recorded.'}
${missing ? `\nTargets with NO work last week:\n${missing}` : ''}

Exercises trained:
${exerciseLines || 'None recorded.'}

Personal records last week:
${prLines}

Return the JSON plan now.`;

  try {
    // 1200, not 2000: output tokens are the entire latency budget here (the
    // program generator measured ~101 tok/s), and this request is the one that
    // was dying before it could answer. /coach/review works at 1400.
    const result = await aiChatCompletion(fastify, userId, PLAN_SYSTEM_PROMPT, userPrompt, {
      tier: 'heavy',
      maxTokens: 1200,
      temperature: 0.4,
    });

    const parsed = JSON.parse(result.content);
    return {
      weekStart: recap.weekStart,
      model: result.model,
      plan: {
        focus: String(parsed.focus ?? '').trim() || 'Here is a plan for next week.',
        days: Array.isArray(parsed.days)
          ? parsed.days.slice(0, 7).map((d: any) => ({
              label: String(d?.label ?? '').trim(),
              workoutType: String(d?.workoutType ?? 'CUSTOM').trim(),
              focus: String(d?.focus ?? '').trim(),
              keyExercises: Array.isArray(d?.keyExercises)
                ? d.keyExercises
                    .filter((x: any) => x && x.name)
                    .map((x: any) => ({
                      name: String(x.name ?? ''),
                      prescription: String(x.prescription ?? ''),
                      why: String(x.why ?? ''),
                    }))
                : [],
            }))
          : [],
        adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments.map(String) : [],
        cautions: Array.isArray(parsed.cautions) ? parsed.cautions.map(String) : [],
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err: (err as Error)?.message }, 'Next-week plan failed to parse');
    throw new AppError(
      502,
      'AI_INVALID_RESPONSE',
      'The coach returned something unreadable. Please try again.',
    );
  }
}
