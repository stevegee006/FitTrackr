import type { FastifyInstance } from 'fastify';
import { tally, performedSets } from './workout-summary.js';

/**
 * Facts for one calendar week — no AI, so the page renders even with no API
 * key configured and revisiting it costs nothing.
 *
 * `weekStart` is a Monday supplied BY THE CLIENT rather than computed here.
 * The week the user sees is their local week, `lib/streak.ts` already derives
 * it that way for the streak and the consistency badges, and a second
 * server-side notion of "this week" would disagree with those for anyone not
 * on UTC. `logDate` is a Postgres `date`, so the range comparison is date-only
 * and no timezone maths is involved.
 */

export interface RecapTotals {
  sessions: number;
  sets: number;
  totalReps: number;
  volumeKg: number;
  durationSec: number;
  distanceM: number;
  /** Sum of each session's recorded wall-clock duration. */
  trainingMin: number;
  /** Logged but never ticked, so excluded — see performedSets. */
  skippedSets: number;
}

type WorkoutWithSets = {
  id: string;
  name: string | null;
  workoutType: string;
  logDate: Date;
  durationMin: number | null;
  completedAt: Date | null;
  sets: Array<{
    exerciseId: string;
    reps: number | null;
    weightKg: number | null;
    durationSec: number | null;
    distanceM: number | null;
    isCompleted: boolean;
    exercise: { id: string; name: string; primaryMuscle: string } | null;
  }>;
};

/** Performed sets across a list of workouts, applying the rule per workout. */
function performedAcross(workouts: WorkoutWithSets[]) {
  return workouts.flatMap((w) => performedSets(w.sets));
}

function totalsFor(workouts: WorkoutWithSets[]): RecapTotals {
  const performed = performedAcross(workouts);
  const t = tally(performed);
  const allSets = workouts.reduce((n, w) => n + w.sets.length, 0);

  return {
    sessions: workouts.length,
    sets: t.sets,
    totalReps: t.totalReps,
    volumeKg: Math.round(t.volumeKg),
    durationSec: t.durationSec,
    distanceM: Math.round(t.distanceM),
    trainingMin: workouts.reduce((n, w) => n + (w.durationMin ?? 0), 0),
    skippedSets: allSets - performed.length,
  };
}

function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const ymd = (d: Date) => d.toISOString().split('T')[0];

export async function getWeeklyRecap(
  fastify: FastifyInstance,
  userId: string,
  weekStart: string,
) {
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = addDays(start, 6);
  const prevStart = addDays(start, -7);
  const prevEnd = addDays(start, -1);

  const select = {
    id: true, name: true, workoutType: true, logDate: true,
    durationMin: true, completedAt: true,
    sets: {
      where: { isWarmup: false },
      select: {
        exerciseId: true, reps: true, weightKg: true,
        durationSec: true, distanceM: true, isCompleted: true,
        exercise: { select: { id: true, name: true, primaryMuscle: true } },
      },
    },
  } as const;

  // Both weeks in one round trip, then split — the previous week is only ever
  // used for the deltas, so it does not need its own query.
  const workouts = (await fastify.prisma.workout.findMany({
    where: { userId, logDate: { gte: prevStart, lte: end } },
    orderBy: { logDate: 'asc' },
    select,
  })) as unknown as WorkoutWithSets[];

  const thisWeek = workouts.filter((w) => w.logDate >= start);
  const prevWeek = workouts.filter((w) => w.logDate <= prevEnd);

  const totals = totalsFor(thisWeek);
  const previous = totalsFor(prevWeek);

  // Sets per muscle, and per-exercise movement across the week.
  const setsByMuscle: Record<string, number> = {};
  // durationSec/distanceM are accumulated alongside the weights, not instead
  // of them: a treadmill walk has no load, and reporting it as "bodyweight"
  // is the same mistake as treating a missing weight as missing data (#74).
  const perExercise = new Map<string, {
    exerciseId: string; name: string; sets: number; tops: number[];
    durationSec: number; distanceM: number;
  }>();

  for (const w of thisWeek) {
    const sessionTop = new Map<string, number>();
    for (const s of performedSets(w.sets)) {
      const muscle = s.exercise?.primaryMuscle;
      if (muscle) setsByMuscle[muscle] = (setsByMuscle[muscle] ?? 0) + 1;

      const entry = perExercise.get(s.exerciseId) ?? {
        exerciseId: s.exerciseId, name: s.exercise?.name ?? 'Exercise', sets: 0, tops: [],
        durationSec: 0, distanceM: 0,
      };
      entry.sets += 1;
      entry.durationSec += s.durationSec ?? 0;
      entry.distanceM += s.distanceM ?? 0;
      perExercise.set(s.exerciseId, entry);

      if (s.weightKg != null) {
        sessionTop.set(s.exerciseId, Math.max(sessionTop.get(s.exerciseId) ?? 0, s.weightKg));
      }
    }
    // One top weight per SESSION, so first→last reads as week-over-session
    // movement rather than set-to-set noise inside a single workout.
    for (const [exId, top] of sessionTop) perExercise.get(exId)?.tops.push(top);
  }

  const exercises = [...perExercise.values()]
    .map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      sessions: e.tops.length,
      sets: e.sets,
      // A recorded 0 kg is "no external load", not a 0 lb top set.
      firstTopKg: e.tops.length && e.tops[0] > 0 ? e.tops[0] : null,
      lastTopKg: e.tops.length && e.tops[e.tops.length - 1] > 0 ? e.tops[e.tops.length - 1] : null,
      durationSec: e.durationSec,
      distanceM: e.distanceM,
    }))
    .sort((a, b) => b.sets - a.sets);

  const prs = await fastify.prisma.personalRecord.findMany({
    where: { userId, achievedAt: { gte: start, lte: addDays(end, 1) } },
    include: { exercise: { select: { name: true } } },
    orderBy: { achievedAt: 'desc' },
  });

  const [goal, profile] = await Promise.all([
    fastify.prisma.trainingGoal.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    }),
    fastify.prisma.userProfile.findUnique({ where: { userId } }),
  ]);

  // Distinct DAYS trained, not sessions: two workouts in one day is one
  // training day, which is how the weekly streak counts it too.
  const trainingDays = new Set(thisWeek.map((w) => ymd(w.logDate))).size;
  const weeklyFrequency = profile?.weeklyFrequency ?? goal?.weeklyFrequency ?? null;

  return {
    weekStart: ymd(start),
    weekEnd: ymd(end),
    sessions: thisWeek.map((w) => ({
      id: w.id,
      name: w.name,
      workoutType: w.workoutType,
      logDate: ymd(w.logDate),
      durationMin: w.durationMin,
      isFinished: w.completedAt != null,
      sets: performedSets(w.sets).length,
    })),
    totals,
    previous: {
      sessions: previous.sessions,
      sets: previous.sets,
      volumeKg: previous.volumeKg,
      trainingMin: previous.trainingMin,
    },
    setsByMuscle,
    weeklyTargets: ((goal?.volumeTargets as any)?.weeklySetTargets ?? null) as Record<string, number> | null,
    exercises,
    personalRecords: prs.map((p) => ({
      exerciseId: p.exerciseId,
      exerciseName: p.exercise?.name ?? 'Exercise',
      recordType: p.recordType,
      value: p.value,
    })),
    goal: {
      weeklyFrequency,
      trainingDays,
      met: weeklyFrequency != null ? trainingDays >= weeklyFrequency : null,
    },
  };
}

export type WeeklyRecap = Awaited<ReturnType<typeof getWeeklyRecap>>;
