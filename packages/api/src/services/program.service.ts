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
  Use negative values for deload weeks.
  Progress PRIMARILY through reps and sets, not RPE. Template RPE should sit
  around 7-8, and rpeDelta must stay within -3..+2 — a program where every
  exercise ends at RPE 9-10 is not usable. Reserve RPE 10 for nothing; the
  server caps upward RPE progression at 9 and at +2 over the template.

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

/**
 * How the program went: adherence against the plan, what was actually lifted,
 * and any PRs set while it was running.
 *
 * Sessions are matched by `Workout.programId`, stamped when a workout is
 * started from a program day. **Workouts logged before migration 0006 have no
 * programId**, so a program that predates it will report 0 completed sessions
 * even if it was followed — the numbers are only meaningful going forward.
 */
export async function getProgramSummary(
  fastify: FastifyInstance,
  userId: string,
  programId: string,
) {
  const program = await fastify.prisma.program.findUnique({ where: { id: programId } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');

  const workouts = await fastify.prisma.workout.findMany({
    where: { userId, programId },
    orderBy: { logDate: 'asc' },
    include: {
      sets: {
        where: { isWarmup: false },
        include: { exercise: { select: { id: true, name: true, primaryMuscle: true } } },
      },
    },
  });

  // Planned session count from the stored plan.
  const data = program.programData as any;
  const weeks: any[] = Array.isArray(data?.weeks) ? data.weeks : [];
  const plannedSessions = weeks.reduce(
    (n, w) => n + (Array.isArray(w?.days) ? w.days.length : 0),
    0,
  );

  let totalSets = 0;
  let totalReps = 0;
  let totalVolumeKg = 0;
  const setsByMuscle: Record<string, number> = {};
  const weeksTouched = new Set<number>();
  const perExercise = new Map<string, { name: string; sets: number; volumeKg: number }>();

  for (const w of workouts) {
    if (w.programWeek != null) weeksTouched.add(w.programWeek);
    for (const s of w.sets) {
      totalSets += 1;
      totalReps += s.reps ?? 0;
      if (s.weightKg != null && s.reps != null) totalVolumeKg += s.weightKg * s.reps;

      const muscle = s.exercise?.primaryMuscle;
      if (muscle) setsByMuscle[muscle] = (setsByMuscle[muscle] ?? 0) + 1;

      const entry = perExercise.get(s.exerciseId) ?? {
        name: s.exercise?.name ?? 'Exercise', sets: 0, volumeKg: 0,
      };
      entry.sets += 1;
      if (s.weightKg != null && s.reps != null) entry.volumeKg += s.weightKg * s.reps;
      perExercise.set(s.exerciseId, entry);
    }
  }

  // Top weight per exercise per session, date-ascending, so "first vs last"
  // compares whole sessions rather than individual sets.
  const topByExerciseSession = new Map<string, Array<{ date: string; top: number }>>();
  for (const w of workouts) {
    const perEx = new Map<string, number>();
    for (const s of w.sets) {
      if (s.weightKg == null) continue;
      perEx.set(s.exerciseId, Math.max(perEx.get(s.exerciseId) ?? 0, s.weightKg));
    }
    for (const [exId, top] of perEx) {
      const arr = topByExerciseSession.get(exId) ?? [];
      arr.push({ date: w.logDate.toISOString().split('T')[0], top });
      topByExerciseSession.set(exId, arr);
    }
  }

  const exercises = [...perExercise.entries()].map(([exerciseId, e]) => {
    const sessions = topByExerciseSession.get(exerciseId) ?? [];
    const firstTop = sessions.length ? sessions[0].top : null;
    const lastTop = sessions.length ? sessions[sessions.length - 1].top : null;
    return {
      exerciseId,
      name: e.name,
      sessions: sessions.length,
      sets: e.sets,
      volumeKg: Math.round(e.volumeKg),
      firstTopWeightKg: firstTop,
      lastTopWeightKg: lastTop,
      changeKg: firstTop != null && lastTop != null ? Math.round((lastTop - firstTop) * 100) / 100 : null,
    };
  }).sort((a, b) => b.volumeKg - a.volumeKg);

  // PRs achieved during the program's date window.
  const first = workouts[0]?.logDate;
  const last = workouts[workouts.length - 1]?.logDate;
  const prs = first && last
    ? await fastify.prisma.personalRecord.findMany({
        where: { userId, achievedAt: { gte: first, lte: last } },
        include: { exercise: { select: { id: true, name: true } } },
        orderBy: { achievedAt: 'asc' },
      })
    : [];

  return {
    program: {
      id: program.id,
      name: program.name,
      durationWeeks: program.durationWeeks,
      isActive: program.isActive,
      aiModel: program.aiModel,
    },
    adherence: {
      plannedSessions,
      completedSessions: workouts.length,
      // Null rather than a misleading 0% when the plan has no days at all.
      percent: plannedSessions > 0
        ? Math.round((workouts.length / plannedSessions) * 100)
        : null,
      weeksTrained: weeksTouched.size,
      firstWorkout: first ? first.toISOString().split('T')[0] : null,
      lastWorkout: last ? last.toISOString().split('T')[0] : null,
    },
    totals: {
      sets: totalSets,
      totalReps,
      volumeKg: Math.round(totalVolumeKg),
      durationMin: workouts.reduce((n, w) => n + (w.durationMin ?? 0), 0),
    },
    setsByMuscle,
    exercises,
    personalRecords: prs.map((p) => ({
      exerciseName: p.exercise?.name ?? 'Exercise',
      recordType: p.recordType,
      value: p.value,
      achievedAt: p.achievedAt.toISOString().split('T')[0],
    })),
  };
}

export async function deleteProgram(fastify: FastifyInstance, userId: string, id: string) {
  const program = await fastify.prisma.program.findUnique({ where: { id } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');
  await fastify.prisma.program.delete({ where: { id } });
}
