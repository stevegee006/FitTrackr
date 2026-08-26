import type { FastifyInstance } from 'fastify';
import type { GenerateProgramInput } from '@fittrackr/shared';
import { aiChatCompletion } from './ai-provider.service.js';
import { NotFoundError, ForbiddenError, AppError } from '../utils/errors.js';
import { expandProgram } from './program-expand.js';
import { logger } from '../utils/logger.js';

/**
 * The model designs ONE week of training plus a compact per-week progression,
 * and the server expands that into the full week-by-week program.
 *
 * Asking for every week longhand does not scale: a measured 8000-token
 * response took 79 s (~101 tok/s), and 24 weeks x 7 days would need ~67k
 * output tokens — past every model's output cap and ~11 minutes of wall
 * clock. One week + deltas is ~4k tokens regardless of duration.
 */
const SYSTEM_PROMPT = `You are an expert personal trainer and strength & conditioning coach. Design a training week and a week-by-week progression scheme.

Return ONLY valid JSON with this structure:
{
  "name": "program name",
  "notes": "optional overall program notes",
  "week": {
    "days": [
      {
        "dayOfWeek": 1,
        "workoutType": "PUSH",
        "focus": "Chest & Triceps",
        "exercises": [
          {
            "name": "Barbell Bench Press",
            "sets": 4,
            "reps": "6-8",
            "rpe": 8,
            "notes": "Focus on chest stretch at bottom",
            "primaryMuscle": "CHEST",
            "equipment": "BARBELL",
            "category": "COMPOUND"
          }
        ]
      }
    ]
  },
  "progression": [
    { "weekNumber": 1, "setsDelta": 0, "repsDelta": 0, "rpeDelta": 0, "note": "Baseline week — establish working weights" }
  ]
}

"week" describes a SINGLE training week — the template repeated through the program.
"progression" MUST contain exactly one entry per program week, in order.
  setsDelta / repsDelta / rpeDelta are integers applied to every exercise that week,
  relative to the template (so week 1 is normally all zeros).
  Use negative values for deload weeks. Keep rpeDelta within -3..+2.

dayOfWeek: 1=Monday, 2=Tuesday, ..., 7=Sunday
workoutType must be one of: PUSH, PULL, LEGS, UPPER, LOWER, FULL_BODY, CARDIO, CUSTOM
primaryMuscle must be one of: CHEST, BACK, SHOULDERS, BICEPS, TRICEPS, FOREARMS, QUADS, HAMSTRINGS, GLUTES, CALVES, CORE, FULL_BODY
equipment must be one of: BARBELL, DUMBBELL, CABLE, MACHINE, BODYWEIGHT, KETTLEBELL, BANDS, OTHER
category must be one of: COMPOUND, ISOLATION, CARDIO, STRETCHING, OTHER
Every exercise MUST include primaryMuscle, equipment, and category.
Rest days must be omitted from the days array.`;

export async function generateProgram(
  fastify: FastifyInstance,
  userId: string,
  input: GenerateProgramInput,
) {
  const { durationWeeks, workoutsPerWeek, primaryGoal, experienceLevel, availableEquipment, preferences } = input;

  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });

  const userPrompt = `Design a ${primaryGoal.toLowerCase()} training week for a ${experienceLevel.toLowerCase()} trainee, plus a ${durationWeeks}-week progression.
Training ${workoutsPerWeek} days per week — the "week" object must contain exactly ${workoutsPerWeek} days.
Available equipment: ${availableEquipment.length > 0 ? availableEquipment.join(', ') : 'Fully equipped gym'}.
${profile?.sex ? `Sex: ${profile.sex}.` : ''}
${preferences ? `Additional preferences: ${preferences}` : ''}

"progression" must contain exactly ${durationWeeks} entries (weekNumber 1 through ${durationWeeks}) applying progressive overload, including a deload week where appropriate.`;

  // Only one week of detail is requested, so this stays ~4k output tokens no
  // matter how long the program is.
  const result = await aiChatCompletion(fastify, userId, SYSTEM_PROMPT, userPrompt, {
    tier: 'heavy',
    maxTokens: 16000,
    temperature: 0.4,
  });

  let raw: any;
  try {
    raw = JSON.parse(result.content);
  } catch {
    logger.error(
      { head: result.content.slice(0, 300), tail: result.content.slice(-300), length: result.content.length },
      'Failed to parse AI program response',
    );
    throw new AppError(
      502,
      'AI_INVALID_RESPONSE',
      'The AI returned a program that could not be read. Please try again.',
    );
  }

  // Accept the legacy full-weeks shape too, in case the model ignores the
  // template instruction and writes every week out longhand anyway.
  const templateDays: any[] = Array.isArray(raw?.week?.days)
    ? raw.week.days
    : Array.isArray(raw?.weeks?.[0]?.days)
      ? raw.weeks[0].days
      : [];

  if (templateDays.length === 0) {
    logger.error({ keys: Object.keys(raw ?? {}) }, 'AI program response had no training days');
    throw new AppError(
      502,
      'AI_INVALID_RESPONSE',
      'The AI returned a program with no training days. Please try again.',
    );
  }

  const progression: any[] = Array.isArray(raw?.progression) ? raw.progression : [];
  const weeks = expandProgram({ days: templateDays }, progression, durationWeeks);

  // Per-week guidance has nowhere to render in the week/day UI, so fold it into
  // the program-level notes the frontend already shows.
  const progressionNotes = progression
    .filter((p) => typeof p?.note === 'string' && p.note.trim())
    .map((p) => `W${p.weekNumber}: ${p.note.trim()}`)
    .join(' · ');

  const name = raw.name ?? `${durationWeeks}-Week ${primaryGoal} Program`;
  const programData = {
    weeks,
    notes: [raw.notes, progressionNotes].filter(Boolean).join('\n\n') || undefined,
  };

  logger.info(
    { weeks: weeks.length, daysPerWeek: templateDays.length, completionTokens: result.usage.completionTokens },
    'Expanded AI program',
  );

  // Deactivate existing programs
  await fastify.prisma.program.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });

  return fastify.prisma.program.create({
    data: {
      userId,
      name,
      durationWeeks,
      programData,
      aiModel: result.model,
      isActive: true,
    },
  });
}

export async function getPrograms(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.program.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getActiveProgram(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.program.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteProgram(fastify: FastifyInstance, userId: string, id: string) {
  const program = await fastify.prisma.program.findUnique({ where: { id } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');
  await fastify.prisma.program.delete({ where: { id } });
}
