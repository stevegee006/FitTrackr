import type { FastifyInstance } from 'fastify';
import type { GenerateProgramInput } from '@fittrackr/shared';
import { muscleGroupValues, equipmentValues, exerciseCategoryValues } from '@fittrackr/shared';
import { aiChatCompletion } from './ai-provider.service.js';
import { NotFoundError, ForbiddenError, AppError } from '../utils/errors.js';
import { expandProgram } from './program-expand.js';
import { applyProgramEdits } from './program-edit.js';
import { programEditSchema } from '@fittrackr/shared';
import type { ProgramEdit } from './program-edit.js';
import { performedSets } from './workout-summary.js';
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
    { "weekNumber": 1, "setsDelta": 0, "repsDelta": 0, "rpeDelta": 0, "note": "Baseline week — establish working weights" },
    { "weekNumber": 3, "setsDelta": 0, "repsDelta": 1, "rpeDelta": 0,
      "exercises": [
        { "name": "Barbell Bench Press", "sets": 5 },
        { "name": "Back Squat", "sets": 5, "notes": "Top set should feel like a hard 8" }
      ],
      "note": "Add a working set to the main compounds; isolation unchanged" },
    { "weekNumber": 6, "setsDelta": -1, "repsDelta": -2, "rpeDelta": -2,
      "isDeload": true, "loadMultiplier": 0.875,
      "note": "Deload — cut volume and take ~12% off the bar" }
  ]
}

"week" describes a SINGLE training week — the template repeated through the program.
"progression" MUST contain exactly one entry per program week, in order.
  setsDelta / repsDelta / rpeDelta are integers applied to every exercise that week,
  relative to the template (so week 1 is normally all zeros).
  Use negative values for deload weeks.

  WRITE THE WEEK'S INTENT AS DATA, NOT ONLY AS PROSE. A note saying "add a set to
  the compounds" changes nothing on its own — only these fields do:

  "exercises" — OPTIONAL sparse list, ONLY for exercises that differ from what the
    uniform deltas would give. Match "name" to the template exactly. Values are
    ABSOLUTE, not deltas: {"name": "Back Squat", "sets": 5} means five sets, not
    five more. May set sets, reps, rpe and notes. Omit the field entirely for a
    week where every exercise moves together. Naming an exercise not in the
    template does nothing.
  "isDeload" — true on a planned back-off week.
  "loadMultiplier" — scales the working weight carried over from the athlete's
    history, e.g. 0.875 for "take about 12% off the bar". Omit it for 1.0.
    This is the ONLY way to change load: the template carries no weights.

  Keep it sparse. A deload usually needs only isDeload and loadMultiplier; a ramp
  week usually names two or three lifts. Do not restate the whole week.
  Progress PRIMARILY through reps and sets, not RPE. Template RPE should sit
  around 7-8, and rpeDelta must stay within -3..+2 — a program where every
  exercise ends at RPE 9-10 is not usable. Reserve RPE 10 for nothing; the
  server caps upward RPE progression at 9 and at +2 over the template.

dayOfWeek: 1=Monday, 2=Tuesday, ..., 7=Sunday
workoutType must be one of: PUSH, PULL, LEGS, UPPER, LOWER, FULL_BODY, CARDIO, CUSTOM
primaryMuscle must be one of: ${muscleGroupValues.join(', ')}
equipment must be one of: ${equipmentValues.join(', ')}
category must be one of: ${exerciseCategoryValues.join(', ')}
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

  // Per-week guidance now rides on its own week and renders above the day
  // strip, so it is NOT folded into the program-level notes any more. Doing so
  // produced a wall of text in which advice for week 6 sat beside advice for
  // week 1 and applied to neither — and, worse, read as the only place that
  // guidance existed while nothing acted on it.
  const name = raw.name ?? `${durationWeeks}-Week ${primaryGoal} Program`;
  const programData = {
    weeks,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
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
    // Performed sets only, per workout — see performedSets. Adherence counted
    // against replayed prefill would overstate how much of the plan was done.
    //
    // `isFinished` matters most here of anywhere: a program's sessions are
    // written ahead as real workouts, so without it adherence counted the plan
    // itself as evidence the plan had been followed — reporting 100% for a
    // week nobody had trained.
    for (const s of performedSets(w.sets, { isFinished: w.completedAt != null })) {
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

  /**
   * Sessions that were actually completed.
   *
   * A program's days are written ahead as real workouts, so `workouts.length`
   * counted the plan itself — and `completedSessions` said what it should have
   * been doing all along. Adherence could read 100% for a program nobody had
   * started, which inverts the only question the number answers.
   */
  const completed = workouts.filter((w) => w.completedAt != null);

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
      completedSessions: completed.length,
      // Null rather than a misleading 0% when the plan has no days at all.
      percent: plannedSessions > 0
        ? Math.round((completed.length / plannedSessions) * 100)
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

/**
 * Apply declarative edits to a generated program.
 *
 * The program is loaded, edited in memory and saved in one write, so a batch
 * that half-applies cannot be what lands in the row. `applied` comes back so
 * the caller can report an edit that matched nothing — a misspelt exercise
 * name otherwise reports success, changes nothing, and is discovered weeks
 * later at the rack.
 */
export async function editProgram(
  fastify: FastifyInstance,
  userId: string,
  programId: string,
  edits: ProgramEdit[],
) {
  const program = await fastify.prisma.program.findUnique({ where: { id: programId } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');

  const { data, applied } = applyProgramEdits(program.programData as any, edits as any);

  const updated = await fastify.prisma.program.update({
    where: { id: programId },
    data: { programData: data },
  });

  logger.info(
    { programId, edits: edits.length, matched: applied.reduce((n, a) => n + a.matched, 0) },
    'Edited program',
  );

  return { program: updated, applied };
}

/**
 * The operation vocabulary, as the model sees it.
 *
 * Kept beside the prompt that uses it so the two cannot drift: an operation
 * added to `program-edit.ts` without a line here is one the model never emits,
 * and a line here without an implementation is one it emits into a warning.
 */
const EDIT_SYSTEM_PROMPT = `You are an expert strength coach editing an existing training program.

You do NOT rewrite the program. You return a short list of EDIT OPERATIONS, which the server applies.

Return ONLY valid JSON:
{
  "summary": "one sentence describing the change, in plain words",
  "edits": [ ... ]
}

Operations:

{ "op": "replaceExercise", "from": "<exact existing name>", "to": { "name": "...", "primaryMuscle": "...", "equipment": "...", "category": "..." }, "weeks": [1,2] }
  Swap one exercise for another. OMIT "weeks" to change every week — that is
  almost always what is meant. "from" MUST match an existing exercise name
  exactly as listed below; an unmatched name changes nothing.
  Always give primaryMuscle, equipment and category for the replacement, or the
  exercise falls out of the volume tracking.

{ "op": "setExerciseFields", "name": "<exact existing name>", "sets": 4, "reps": "8-12", "rpe": 8, "notes": "...", "weeks": [5,6] }
  Change what is prescribed. Include only the fields that change.

{ "op": "removeExercise", "name": "<exact existing name>", "weeks": [6] }

{ "op": "setWeekNote", "weekNumber": 6, "note": "..." }

Rules:
- Emit the FEWEST operations that achieve the request. One swap across the
  whole program is ONE operation with no "weeks", not one per week.
- Never invent exercise names in "from" or "name". Use the list given.
- If the request is unclear or names nothing in the program, return an empty
  "edits" array and say why in "summary". Do not guess.
- primaryMuscle, equipment and category must come from the allowed values given.`;

/**
 * Turn a plain-language instruction into edit operations — WITHOUT saving.
 *
 * Returns a preview: the operations, and how many entries each would touch,
 * computed by running the real apply against a copy. Nothing is written until
 * the caller posts the operations to the edit endpoint, so a model that
 * misunderstands costs a glance rather than a program.
 *
 * The model is given a COMPACT listing — day focuses and exercise names, not
 * the whole `programData`. Partly tokens, mostly discipline: a model handed
 * the full JSON tends to return full JSON, and the entire point of the
 * operation vocabulary is that changes stay small enough to read.
 */
export async function aiEditProgram(
  fastify: FastifyInstance,
  userId: string,
  programId: string,
  instruction: string,
) {
  const program = await fastify.prisma.program.findUnique({ where: { id: programId } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');

  const data = program.programData as any;
  const weeks: any[] = Array.isArray(data?.weeks) ? data.weeks : [];
  if (weeks.length === 0) {
    throw new AppError(422, 'PROGRAM_EMPTY', 'This program has no weeks to edit.');
  }

  // Week 1 names everything: the weeks share a template, so later weeks differ
  // in numbers rather than in which exercises exist.
  const listing = (weeks[0]?.days ?? [])
    .map((day: any) => {
      const names = (day?.exercises ?? [])
        .map((ex: any) => `    - ${ex?.name} (${ex?.sets} x ${ex?.reps}${ex?.rpe ? `, RPE ${ex.rpe}` : ''})`)
        .join('\n');
      return `  Day ${day?.dayOfWeek} — ${day?.focus ?? day?.workoutType}:\n${names}`;
    })
    .join('\n');

  const userPrompt = `Program: ${program.name}
Weeks: ${weeks.length} (numbered 1 to ${weeks.length})

Exercises, by day:
${listing}

Allowed primaryMuscle: ${muscleGroupValues.join(', ')}
Allowed equipment: ${equipmentValues.join(', ')}
Allowed category: ${exerciseCategoryValues.join(', ')}

The athlete asks:
"""
${instruction}
"""`;

  const result = await aiChatCompletion(fastify, userId, EDIT_SYSTEM_PROMPT, userPrompt, {
    tier: 'light',
    maxTokens: 2000,
    temperature: 0.2,
  });

  let raw: any;
  try {
    raw = JSON.parse(result.content);
  } catch {
    logger.error({ head: result.content.slice(0, 300) }, 'Failed to parse AI program edit');
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The AI returned something unreadable. Please try again.');
  }

  // Validate each operation separately: one malformed edit should cost that
  // edit, not the whole instruction.
  const candidates: any[] = Array.isArray(raw?.edits) ? raw.edits : [];
  const edits: ProgramEdit[] = [];
  const rejected: string[] = [];
  for (const c of candidates) {
    const parsed = programEditSchema.safeParse(c);
    if (parsed.success) edits.push(parsed.data as ProgramEdit);
    else rejected.push(`${c?.op ?? 'unknown'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }

  // Dry run against a copy — the real apply, so the counts shown are the
  // counts that will happen rather than a second implementation that could
  // disagree with the first.
  const { applied } = applyProgramEdits(data, edits as any);

  logger.info(
    { programId, proposed: candidates.length, valid: edits.length, rejected: rejected.length },
    'AI proposed program edits',
  );

  return {
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    edits,
    preview: applied,
    rejected,
  };
}
