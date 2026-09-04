/**
 * Pure tallying for the end-of-workout summary. Kept separate from
 * workout.service so the arithmetic the user actually reads is unit-testable
 * without a database.
 */

export interface SetLike {
  reps: number | null;
  weightKg: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  isCompleted?: boolean;
}

/**
 * The sets that actually count as performed.
 *
 * Adding an exercise REPLAYS the last session (see the add-exercise fallback
 * chain), so a workout routinely contains rows pre-filled with last week's
 * weight and reps that were never done. Tallying every non-warmup set counted
 * those as work: an untouched superset showed "3 sets · 24 reps · 2,400 lbs"
 * on the recap while every checkbox in it was still empty.
 *
 * Strictly filtering on `isCompleted` is not safe on its own. The column
 * arrived in migration 0004 with `DEFAULT false`, so every set logged before
 * 2026-05-09 reads as incomplete, and a session where the boxes simply were
 * never ticked is indistinguishable from one where nothing was done. Either
 * would make a past workout tally to zero and the "last time" comparison
 * vanish.
 *
 * So the rule is per WORKOUT, not per set or per exercise: if anything in the
 * workout was ticked, the ticks are meaningful and only ticked sets count;
 * if nothing was, fall back to counting everything. Legacy sessions keep the
 * numbers they have always shown, and no back-fill is needed.
 *
 * Pass one workout's non-warmup sets. Passing a single exercise's sets would
 * reintroduce the reported bug, because an exercise nobody ticked inside an
 * otherwise-ticked session would fall back to counting all of its sets.
 */
export function performedSets<T extends SetLike>(workoutSets: T[]): T[] {
  const completed = workoutSets.filter((s) => s.isCompleted);
  return completed.length > 0 ? completed : workoutSets;
}

export interface ExerciseTally {
  sets: number;
  totalReps: number;
  volumeKg: number;
  topWeightKg: number | null;
  bestSet: { reps: number; weightKg: number } | null;
  /** Time-based work. Zero for pure strength sets. */
  durationSec: number;
  /** Distance covered, in metres. Zero for pure strength sets. */
  distanceM: number;
}

export interface TallyDelta {
  sets: number;
  totalReps: number;
  volumeKg: number;
  topWeightKg: number | null;
  durationSec: number;
  distanceM: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Volume is weight x reps, so a set missing either is counted toward `sets`
 * but contributes no volume — bodyweight and cardio sets must not silently
 * read as zero-weight strength work.
 */
export function tally(sets: SetLike[]): ExerciseTally {
  const t: ExerciseTally = {
    sets: 0, totalReps: 0, volumeKg: 0, topWeightKg: null, bestSet: null,
    durationSec: 0, distanceM: 0,
  };
  let bestVolume = -1;

  for (const s of sets) {
    t.sets += 1;
    t.totalReps += s.reps ?? 0;
    // Time and distance accumulate independently of weight/reps, so a 9-minute
    // walk reads as 9 minutes rather than "1 set, 0 reps".
    t.durationSec += s.durationSec ?? 0;
    t.distanceM += s.distanceM ?? 0;
    if (s.weightKg == null) continue;
    if (t.topWeightKg == null || s.weightKg > t.topWeightKg) t.topWeightKg = s.weightKg;
    if (s.reps == null) continue;
    const v = s.weightKg * s.reps;
    t.volumeKg += v;
    if (v > bestVolume) {
      bestVolume = v;
      t.bestSet = { reps: s.reps, weightKg: s.weightKg };
    }
  }

  t.volumeKg = round2(t.volumeKg);
  return t;
}

/** Current minus previous. `topWeightKg` is null unless both sides have one. */
export function diffTally(current: ExerciseTally, previous: ExerciseTally): TallyDelta {
  return {
    sets: current.sets - previous.sets,
    totalReps: current.totalReps - previous.totalReps,
    volumeKg: round2(current.volumeKg - previous.volumeKg),
    topWeightKg:
      current.topWeightKg != null && previous.topWeightKg != null
        ? round2(current.topWeightKg - previous.topWeightKg)
        : null,
    durationSec: current.durationSec - previous.durationSec,
    distanceM: round2(current.distanceM - previous.distanceM),
  };
}
