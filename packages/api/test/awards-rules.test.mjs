/** Tests for the Awards rules. Run via `pnpm --filter @fittrackr/api test`. */
import { classifyLift, evaluateAwards, streakHistory, LB_PER_KG } from '../dist/services/awards-rules.js';

let pass = 0;
const failures = [];
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else failures.push(`${label}\n    got  ${g}\n    want ${w}`);
}

// ─── classifyLift ─────────────────────────────────────────────────────────────
eq('barbell bench press', classifyLift('Barbell Bench Press'), 'BENCH');
eq('plain bench press', classifyLift('Bench Press'), 'BENCH');
// Variations must NOT count — awarding a "225 bench" for an incline would be wrong.
eq('incline is not the bench', classifyLift('Barbell Incline Bench Press'), null);
eq('decline is not the bench', classifyLift('Decline Bench Press'), null);
eq('dumbbell is not the bench', classifyLift('Dumbbell Bench Press'), null);
eq('smith is not the bench', classifyLift('Smith Machine Bench Press'), null);
eq('close grip is not the bench', classifyLift('Close Grip Bench Press'), null);

eq('back squat', classifyLift('Barbell Squat'), 'SQUAT');
eq('front squat excluded', classifyLift('Front Squat'), null);
eq('goblet squat excluded', classifyLift('Goblet Squat'), null);
eq('bulgarian split squat excluded', classifyLift('Bulgarian Split Squat'), null);
eq('hack squat excluded', classifyLift('Hack Squat'), null);

eq('deadlift', classifyLift('Deadlift'), 'DEADLIFT');
eq('barbell deadlift', classifyLift('Barbell Deadlift'), 'DEADLIFT');
eq('RDL excluded', classifyLift('Romanian Deadlift'), null);
eq('stiff-leg excluded', classifyLift('Stiff Leg Deadlift'), null);

eq('overhead press', classifyLift('Overhead Press'), 'OHP');
eq('military press', classifyLift('Military Press'), 'OHP');
eq('barbell shoulder press', classifyLift('Barbell Shoulder Press'), 'OHP');
eq('dumbbell shoulder press excluded', classifyLift('Dumbbell Shoulder Press'), null);
eq('leg press is not a press', classifyLift('Leg Press'), null);
eq('chest press is not a press', classifyLift('Machine Chest Press'), null);
eq('tricep pushdown is nothing', classifyLift('Cable Tricep Pushdown'), null);
eq('empty name', classifyLift(''), null);

// ─── Absolute tiers ───────────────────────────────────────────────────────────
{
  const a = evaluateAwards({ BENCH: 225 / LB_PER_KG }, null);
  eq('exactly 225 lb earns Two Plate', a.find((x) => x.id === 'bench-225').earned, true);
  eq('225 does not earn Three Plate', a.find((x) => x.id === 'bench-315').earned, false);
  eq('progress toward 315 is partial', Math.round(a.find((x) => x.id === 'bench-315').progress * 100), 71);
  eq('one plate also earned', a.find((x) => x.id === 'bench-135').earned, true);
}
{
  const a = evaluateAwards({ BENCH: 224.9 / LB_PER_KG }, null);
  eq('224.9 lb does not earn 225', a.find((x) => x.id === 'bench-225').earned, false);
}
{
  // A kg round-trip must not rob a genuine 225 lb lift.
  const a = evaluateAwards({ BENCH: Math.round((225 / LB_PER_KG) * 100) / 100 }, null);
  eq('rounded-kg 225 still earns it', a.find((x) => x.id === 'bench-225').earned, true);
}
{
  const a = evaluateAwards({}, null);
  eq('never lifted: nothing earned', a.every((x) => !x.earned), true);
  eq('never lifted: absolute progress 0', a.find((x) => x.id === 'bench-225').progress, 0);
  eq('never lifted: bestKg null', a.find((x) => x.id === 'bench-225').bestKg, null);
}

// ─── Relative tiers ───────────────────────────────────────────────────────────
{
  const a = evaluateAwards({ BENCH: 80 }, 80);
  eq('80kg bench at 80kg bodyweight earns 1x', a.find((x) => x.id === 'rel-bench-1').earned, true);
  eq('does not earn 1.5x', a.find((x) => x.id === 'rel-bench-1.5').earned, false);
  eq('1.5x progress is two thirds', Math.round(a.find((x) => x.id === 'rel-bench-1.5').progress * 100), 67);
}
{
  // No bodyweight on file: relative awards are unknowable, not "no progress".
  const a = evaluateAwards({ BENCH: 100 }, null);
  const rel = a.find((x) => x.id === 'rel-bench-1');
  eq('no bodyweight: not earned', rel.earned, false);
  eq('no bodyweight: progress null, not 0', rel.progress, null);
  eq('no bodyweight: target null', rel.targetKg, null);
  eq('absolute awards still work without bodyweight', a.find((x) => x.id === 'bench-135').earned, true);
}
eq('progress never exceeds 1', evaluateAwards({ SQUAT: 400 }, 60).find((x) => x.id === 'rel-squat-1.5').progress, 1);

// ─── Streak history ───────────────────────────────────────────────────────────
function daysFrom(monday, n) {
  const [y, m, d] = monday.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  }
  return out;
}
{
  const dates = [
    ...daysFrom('2026-07-06', 3),
    ...daysFrom('2026-07-13', 3),
    ...daysFrom('2026-07-20', 3),
    ...daysFrom('2026-07-27', 1),
    ...daysFrom('2026-08-03', 3),
    ...daysFrom('2026-08-10', 3),
  ];
  const h = streakHistory(dates, '2026-08-16', 3);
  eq('best run is the first three', h.best, 3);
  eq('best run start', h.bestStart, '2026-07-06');
  eq('best run end', h.bestEnd, '2026-07-20');
  eq('current run is the last two', h.current, 2);
  eq('total weeks at goal', h.totalWeeksAtGoal, 5);
}
{
  // A week with NO workouts at all must break the run, not be skipped over.
  const h = streakHistory([...daysFrom('2026-07-06', 3), ...daysFrom('2026-07-20', 3)], '2026-07-26', 3);
  eq('an empty week breaks the run', h.best, 1);
  eq('current is just the latest week', h.current, 1);
}
{
  const h = streakHistory([], '2026-08-16', 3);
  eq('no history: best 0', h.best, 0);
  eq('no history: current 0', h.current, 0);
  eq('no history: no dates', [h.bestStart, h.bestEnd], [null, null]);
}
{
  // An in-progress week short of the goal must not zero the current run.
  const h = streakHistory([...daysFrom('2026-08-03', 3), ...daysFrom('2026-08-10', 2)], '2026-08-12', 3);
  eq('mid-week shortfall keeps the prior run', h.current, 1);
}
eq('goal clamped to 7', streakHistory(['2026-08-03'], '2026-08-03', 99).goal, 7);

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
