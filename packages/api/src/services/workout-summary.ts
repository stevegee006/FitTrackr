/**
 * Pure tallying for the end-of-workout summary. Kept separate from
 * workout.service so the arithmetic the user actually reads is unit-testable
 * without a database.
 */

export interface SetLike {
  reps: number | null;
  weightKg: number | null;
}

export interface ExerciseTally {
  sets: number;
  totalReps: number;
  volumeKg: number;
  topWeightKg: number | null;
  bestSet: { reps: number; weightKg: number } | null;
}

export interface TallyDelta {
  sets: number;
  totalReps: number;
  volumeKg: number;
  topWeightKg: number | null;
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
  };
  let bestVolume = -1;

  for (const s of sets) {
    t.sets += 1;
    t.totalReps += s.reps ?? 0;
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
  };
}
