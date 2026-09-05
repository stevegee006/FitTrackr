import type { FastifyInstance } from 'fastify';
import { aiChatCompletion } from './ai-provider.service.js';
import { getWeeklyRecap } from './weekly-recap.service.js';
import { getWorkoutSummary } from './workout.service.js';
import { SYSTEM_PROMPT } from './coach.service.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Coach reviews scoped to one week and to one session.
 *
 * Both reuse the 30-day review's ANSWER shape so the frontend renders all three
 * with a single component, and both are built from the same facts the page they
 * sit on already displays — the weekly recap and the workout summary — so the
 * advice cannot cite numbers that disagree with what is on screen.
 *
 * Separate from coach.service.ts only to stop that file becoming the place
 * every AI feature lands.
 */

export interface CoachReview {
  headline: string;
  wins: string[];
  concerns: string[];
  suggestions: Array<{ title: string; detail: string }>;
  focusNextWeek: string | null;
}

/** Model output is untrusted: coerce every field and bound every list. */
function parseReview(raw: any, fallbackHeadline: string): CoachReview {
  return {
    headline: String(raw?.headline ?? '').trim() || fallbackHeadline,
    wins: Array.isArray(raw?.wins) ? raw.wins.slice(0, 6).map(String) : [],
    concerns: Array.isArray(raw?.concerns) ? raw.concerns.slice(0, 6).map(String) : [],
    suggestions: Array.isArray(raw?.suggestions)
      ? raw.suggestions
          .filter((x: any) => x && (x.title || x.detail))
          .slice(0, 6)
          .map((x: any) => ({ title: String(x.title ?? ''), detail: String(x.detail ?? '') }))
      : [],
    focusNextWeek: String(raw?.focusNextWeek ?? '').trim() || null,
  };
}

/** The user's display unit plus a kg→display converter. */
async function unitsFor(fastify: FastifyInstance, userId: string) {
  const settings = await fastify.prisma.userSettings.findUnique({
    where: { userId },
    select: { preferredUnits: true },
  });
  const isImperial = settings?.preferredUnits === 'IMPERIAL';
  return {
    isImperial,
    unit: isImperial ? 'lbs' : 'kg',
    conv: (kg: number) => (isImperial ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10),
  };
}

/** Time and distance FIRST — a walk described as "bodyweight" invites rep advice (#74). */
function describeWork(
  e: { firstTopKg: number | null; lastTopKg: number | null; durationSec: number; distanceM: number },
  isImperial: boolean,
  unit: string,
  conv: (kg: number) => number,
) {
  if (e.durationSec > 0 || e.distanceM > 0) {
    return [
      e.durationSec > 0 ? `${Math.round(e.durationSec / 60)} min` : null,
      e.distanceM > 0
        ? isImperial
          ? `${(e.distanceM / 1609.344).toFixed(2)} mi`
          : `${(e.distanceM / 1000).toFixed(2)} km`
        : null,
    ].filter(Boolean).join(', ');
  }
  if (e.firstTopKg != null && e.lastTopKg != null) {
    return e.firstTopKg === e.lastTopKg
      ? `top ${conv(e.lastTopKg)}${unit}`
      : `top ${conv(e.firstTopKg)}→${conv(e.lastTopKg)}${unit}`;
  }
  return 'bodyweight';
}

/**
 * The provider call plus its logging and error shaping.
 *
 * The two log lines exist because a browser-side `fetch` rejection carries no
 * HTTP response, so "the proxy cut it", "CORS" and "the process died" are
 * indistinguishable from the client. Fastify's own completion line carries the
 * reqId but NOT the url, so grepping by endpoint only ever finds the incoming
 * request — which made a failure look like a hang and cost a wrong diagnosis.
 */
async function runReview(
  fastify: FastifyInstance,
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  label: string,
) {
  const startedAt = Date.now();
  logger.info({ userId, label }, 'coach review: calling provider');
  try {
    const result = await aiChatCompletion(fastify, userId, systemPrompt, userPrompt, {
      tier: 'heavy',
      maxTokens: 1400,
      temperature: 0.4,
    });
    logger.info(
      { userId, label, model: result.model, ms: Date.now() - startedAt, chars: result.content.length },
      'coach review: provider responded',
    );
    return { model: result.model, parsed: JSON.parse(result.content) };
  } catch (err) {
    logger.error(
      { userId, label, err: (err as Error)?.message, ms: Date.now() - startedAt },
      'coach review: failed',
    );
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The coach returned something unreadable. Please try again.');
  }
}

// ─── One week ────────────────────────────────────────────────────────────────

const WEEK_REVIEW_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

This is ONE WEEK, not a 30-day block. Judge it as a week: do not present a
single week's numbers as a trend, and say plainly when there is not enough here
to draw a conclusion.`;

export async function getWeekReview(
  fastify: FastifyInstance,
  userId: string,
  weekStart: string,
) {
  const recap = await getWeeklyRecap(fastify, userId, weekStart);

  if (recap.totals.sessions === 0) {
    // Nothing to analyse — don't spend an AI call to be told there is no data.
    throw new AppError(
      422,
      'NO_TRAINING_DATA',
      'No workouts logged that week, so there is nothing to review.',
    );
  }

  const { isImperial, unit, conv } = await unitsFor(fastify, userId);
  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });

  const muscleLines = Object.entries(recap.setsByMuscle)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => {
      const target = recap.weeklyTargets?.[m];
      return target != null ? `${m}: ${n} sets (target ${target})` : `${m}: ${n} sets`;
    })
    .join('\n');

  // A target with zero sets cannot appear in setsByMuscle, which only holds
  // muscles that were trained — so the gap has to be derived from the targets.
  const missing = Object.entries(recap.weeklyTargets ?? {})
    .filter(([m, target]) => (target ?? 0) > 0 && !(recap.setsByMuscle[m] > 0))
    .map(([m, target]) => `${m}: 0 sets (target ${target})`)
    .join('\n');

  const exerciseLines = recap.exercises
    .slice(0, 12)
    .map((e) => `${e.name}: ${e.sets} sets over ${e.sessions} session(s), ${describeWork(e, isImperial, unit, conv)}`)
    .join('\n');

  const userPrompt = `Review the training week of ${recap.weekStart} to ${recap.weekEnd}. Units: ${unit}.
${profile?.goal ? `Stated goal: ${profile.goal}.` : ''}
${recap.goal.weeklyFrequency ? `Target ${recap.goal.weeklyFrequency} training days/week; trained ${recap.goal.trainingDays}.` : ''}

Sessions: ${recap.totals.sessions}
Working sets: ${recap.totals.sets}, reps: ${recap.totals.totalReps}, volume: ${conv(recap.totals.volumeKg)} ${unit}
Week before: ${recap.previous.sessions} sessions, ${recap.previous.sets} sets, ${conv(recap.previous.volumeKg)} ${unit}

Sets per muscle group:
${muscleLines || 'None recorded.'}
${missing ? `\nTargets with NO work at all:\n${missing}` : ''}

Exercises:
${exerciseLines || 'None recorded.'}

Personal records: ${
    recap.personalRecords.length
      ? recap.personalRecords.map((p) => `${p.exerciseName} ${p.recordType}`).join(', ')
      : 'None.'
  }

Return the JSON review now.`;

  const result = await runReview(fastify, userId, WEEK_REVIEW_SYSTEM_PROMPT, userPrompt, 'week');
  return {
    weekStart: recap.weekStart,
    model: result.model,
    review: parseReview(result.parsed, 'Here is how the week looked.'),
  };
}

// ─── One session ─────────────────────────────────────────────────────────────

const SESSION_REVIEW_SYSTEM_PROMPT = `You are an experienced strength coach reviewing ONE training session an athlete has just finished. Be specific and reference their actual numbers.

Return ONLY valid JSON with this exact structure:
{
  "headline": "one sentence on how the session went",
  "wins": ["1-3 short specific positives from THIS session"],
  "concerns": ["0-2 short specific issues — omit anything the data does not support"],
  "suggestions": [
    { "title": "short imperative", "detail": "1-2 sentences on what to do next time" }
  ],
  "focusNextWeek": "one sentence on what to carry into the next session of this type"
}

Rules:
- This is a SINGLE session. Do not present it as a trend, and do not comment on
  weekly volume — you cannot see the rest of the week from here.
- 2-3 suggestions, each about a specific exercise in this session and what to do
  the next time it comes round.
- Beating a rep range means ADD LOAD next time. Never suggest a deload for an
  athlete who is progressing; reserve that for genuine stalling or regression.
- Bodyweight and cardio work log no weight. That is not missing data.
- Keep it short. This is read on a phone straight after training.
- Never give medical advice or diagnose injuries. Suggest seeing a professional
  if the athlete's notes mention pain.`;

export async function getSessionReview(
  fastify: FastifyInstance,
  userId: string,
  workoutId: string,
) {
  const summary = await getWorkoutSummary(fastify, userId, workoutId);

  if (summary.totals.sets === 0) {
    throw new AppError(
      422,
      'NO_TRAINING_DATA',
      'This session has no completed sets yet, so there is nothing to review.',
    );
  }

  const { unit, conv } = await unitsFor(fastify, userId);

  const exerciseLines = summary.exercises
    .map((e) => {
      const bits = [`${e.current.sets} sets`, `${e.current.totalReps} reps`];
      if (e.current.topWeightKg != null) bits.push(`top ${conv(e.current.topWeightKg)}${unit}`);
      if (e.current.durationSec > 0) bits.push(`${Math.round(e.current.durationSec / 60)} min`);

      // "Last time" is per EXERCISE, not per workout — it may be several
      // sessions ago, and the date is given so the model does not assume it
      // was the previous session (#68).
      const prev = e.previous
        ? ` — last time (${e.previousDate}): ${e.previous.sets} sets, ${e.previous.totalReps} reps${
            e.previous.topWeightKg != null ? `, top ${conv(e.previous.topWeightKg)}${unit}` : ''
          }`
        : ' — first time logged';
      return `${e.name}: ${bits.join(', ')}${prev}`;
    })
    .join('\n');

  const userPrompt = `Review this single training session. Units: ${unit}.

${summary.workout.name ?? summary.workout.workoutType} on ${summary.workout.logDate}${
    summary.workout.durationMin ? `, ${summary.workout.durationMin} min` : ''
  }
Totals: ${summary.totals.sets} working sets, ${summary.totals.totalReps} reps, ${conv(summary.totals.volumeKg)} ${unit} volume

Per exercise, compared with the last session containing that exercise:
${exerciseLines || 'None recorded.'}

Personal records set: ${
    summary.personalRecords.length
      ? summary.personalRecords.map((p) => `${p.exerciseName} ${p.recordType}`).join(', ')
      : 'None.'
  }

Return the JSON review now.`;

  const result = await runReview(fastify, userId, SESSION_REVIEW_SYSTEM_PROMPT, userPrompt, 'session');
  return {
    workoutId,
    model: result.model,
    review: parseReview(result.parsed, 'Here is how the session looked.'),
  };
}
