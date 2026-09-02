/**
 * Tests for the workout-summary tallies — the numbers shown on the
 * end-of-session recap. Run via `pnpm --filter @fittrackr/api test`.
 */
import { tally, diffTally } from '../dist/services/workout-summary.js';

let pass = 0;
const failures = [];
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else failures.push(`${label}\n    got  ${g}\n    want ${w}`);
}

const S = (...pairs) => pairs.map(([reps, weightKg]) => ({ reps, weightKg }));
const C = (...pairs) => pairs.map(([durationSec, distanceM]) => ({ reps: null, weightKg: null, durationSec, distanceM }));

// ─── tally ────────────────────────────────────────────────────────────────────
const bench = tally(S([8, 60], [8, 60], [6, 65]));
eq('set count', bench.sets, 3);
eq('total reps', bench.totalReps, 22);
eq('volume = sum(w*r)', bench.volumeKg, 60 * 8 + 60 * 8 + 65 * 6); // 1350
eq('top weight', bench.topWeightKg, 65);
eq('best set is highest-volume set', bench.bestSet, { reps: 8, weightKg: 60 });

eq('empty', tally([]), { sets: 0, totalReps: 0, volumeKg: 0, topWeightKg: null, bestSet: null, durationSec: 0, distanceM: 0 });

// Bodyweight / cardio sets must count as sets but contribute no volume, and
// must not be treated as zero-weight strength work.
const bw = tally([{ reps: 12, weightKg: null }, { reps: 10, weightKg: null }]);
eq('bodyweight: sets counted', bw.sets, 2);
eq('bodyweight: reps counted', bw.totalReps, 22);
eq('bodyweight: no volume', bw.volumeKg, 0);
eq('bodyweight: no top weight', bw.topWeightKg, null);
eq('bodyweight: no best set', bw.bestSet, null);

const noReps = tally([{ reps: null, weightKg: 100 }]);
eq('weight but no reps: no volume', noReps.volumeKg, 0);
eq('weight but no reps: top weight still tracked', noReps.topWeightKg, 100);
eq('weight but no reps: no best set', noReps.bestSet, null);

const mixed = tally([{ reps: 10, weightKg: 40 }, { reps: 12, weightKg: null }]);
eq('mixed: only the loaded set counts to volume', mixed.volumeKg, 400);
eq('mixed: both count as sets', mixed.sets, 2);
eq('mixed: reps include the bodyweight set', mixed.totalReps, 22);

eq('fractional volume rounds to 2dp', tally(S([3, 2.5]))['volumeKg'], 7.5);
eq('float noise is rounded away', tally(S([3, 20.41], [3, 20.41])).volumeKg, 122.46);

// Best set prefers volume, not the heaviest weight.
const heavySingle = tally(S([1, 100], [10, 50]));
eq('best set = 10x50 (500) over 1x100 (100)', heavySingle.bestSet, { reps: 10, weightKg: 50 });
eq('top weight is still the single', heavySingle.topWeightKg, 100);

// ─── Time-based work ──────────────────────────────────────────────────────────
// A 9-minute walk used to read as "1 set, 1 rep" because duration was ignored.
const walk = tally(C([540, 1200]));
eq('walk: one set', walk.sets, 1);
eq('walk: 9 minutes counted', walk.durationSec, 540);
eq('walk: 1.2km counted', walk.distanceM, 1200);
eq('walk: no phantom reps', walk.totalReps, 0);
eq('walk: no phantom volume', walk.volumeKg, 0);
eq('walk: no top weight', walk.topWeightKg, null);

const intervals = tally(C([120, 400], [120, 380], [120, 410]));
eq('intervals: sets', intervals.sets, 3);
eq('intervals: total time', intervals.durationSec, 360);
eq('intervals: total distance', intervals.distanceM, 1190);

eq('strength sets report zero duration', tally(S([8, 60])).durationSec, 0);
eq('strength sets report zero distance', tally(S([8, 60])).distanceM, 0);

// A loaded carry has weight AND time — both must count.
const carry = tally([{ reps: null, weightKg: 40, durationSec: 60, distanceM: 50 }]);
eq('carry: duration counted', carry.durationSec, 60);
eq('carry: top weight counted', carry.topWeightKg, 40);
eq('carry: no volume without reps', carry.volumeKg, 0);

// ─── diffTally ────────────────────────────────────────────────────────────────
const prev = tally(S([8, 60], [8, 60], [8, 60]));   // 3 sets, 24 reps, 1440
const curr = tally(S([8, 65], [8, 65], [6, 65]));   // 3 sets, 22 reps, 1430

eq('progressed weight', diffTally(curr, prev).topWeightKg, 5);
eq('fewer reps', diffTally(curr, prev).totalReps, -2);
eq('same set count', diffTally(curr, prev).sets, 0);
eq('slightly less volume', diffTally(curr, prev).volumeKg, -10);

eq(
  'identical sessions diff to zero',
  diffTally(prev, prev),
  { sets: 0, totalReps: 0, volumeKg: 0, topWeightKg: 0, durationSec: 0, distanceM: 0 },
);

// Cardio progress shows as time/distance, not reps.
const walkNow = tally(C([600, 1400]));
const walkPrev = tally(C([540, 1200]));
eq('walked a minute longer', diffTally(walkNow, walkPrev).durationSec, 60);
eq('walked 200m further', diffTally(walkNow, walkPrev).distanceM, 200);
eq('reps delta stays zero for cardio', diffTally(walkNow, walkPrev).totalReps, 0);
eq(
  'topWeight null when either side is unloaded',
  diffTally(tally(S([10, 50])), bw).topWeightKg,
  null,
);
eq(
  'volume delta still computed when one side is unloaded',
  diffTally(tally(S([10, 50])), bw).volumeKg,
  500,
);

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
