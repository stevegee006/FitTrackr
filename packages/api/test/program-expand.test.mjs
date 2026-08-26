/**
 * Tests for the AI program expander.
 *
 * The project has no test framework, so this is a plain node script with a
 * process exit code — run it with `pnpm --filter @fittrackr/api test`, which
 * builds first (it imports from dist/).
 */
import {
  shiftReps,
  clampRpe,
  expandProgram,
  RPE_CEILING,
  MAX_RPE_RISE,
} from '../dist/services/program-expand.js';

let pass = 0;
const failures = [];

function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else failures.push(`${label}\n    got  ${g}\n    want ${w}`);
}

// ─── shiftReps ────────────────────────────────────────────────────────────────
eq('range +2', shiftReps('6-8', 2), '8-10');
eq('range -2', shiftReps('6-8', -2), '4-6');
eq('single +1', shiftReps('8', 1), '9');
eq('floor at 1', shiftReps('2', -9), '1');
eq('range floor', shiftReps('1-2', -9), '1-1');
eq('zero delta untouched', shiftReps('6-8', 0), '6-8');
eq('non-numeric untouched', shiftReps('AMRAP', 3), 'AMRAP');
eq('duration untouched', shiftReps('30s', 3), '30s');
eq('null safe', shiftReps(null, 2), '');

// ─── clampRpe ─────────────────────────────────────────────────────────────────
eq('constants', [RPE_CEILING, MAX_RPE_RISE], [9, 2]);
// Upward progression is capped: never above 9, never more than +2 over template.
eq('8 +1 -> 9', clampRpe(8, 1), 9);
eq('8 +2 -> 9 (ceiling, not 10)', clampRpe(8, 2), 9);
eq('8 +5 -> 9', clampRpe(8, 5), 9);
eq('7 +1 -> 8', clampRpe(7, 1), 8);
eq('7 +2 -> 9', clampRpe(7, 2), 9);
eq('7 +9 -> 9 (rise cap)', clampRpe(7, 9), 9);
eq('6 +9 -> 8 (rise cap beats ceiling)', clampRpe(6, 9), 8);
eq('9 +3 -> 9', clampRpe(9, 3), 9);
// Template weeks and deloads pass through untouched.
eq('delta 0 passes through', clampRpe(8, 0), 8);
eq('template 10 at delta 0 kept', clampRpe(10, 0), 10);
eq('deload 8 -3 -> 5', clampRpe(8, -3), 5);
eq('deload floors at 1', clampRpe(2, -9), 1);
eq('rpe undefined passthrough', clampRpe(undefined, 2), undefined);
eq('rpe non-number', clampRpe('hard', 2), undefined);

// ─── expandProgram ────────────────────────────────────────────────────────────
const template = {
  days: [
    {
      dayOfWeek: 1,
      workoutType: 'PUSH',
      focus: 'Chest & Triceps',
      exercises: [
        {
          name: 'Barbell Bench Press', sets: 4, reps: '6-8', rpe: 8,
          notes: 'stretch at bottom', primaryMuscle: 'CHEST',
          equipment: 'BARBELL', category: 'COMPOUND',
        },
        {
          name: 'Cable Fly', sets: 3, reps: '12-15', rpe: 7,
          primaryMuscle: 'CHEST', equipment: 'CABLE', category: 'ISOLATION',
        },
      ],
    },
    {
      dayOfWeek: 3,
      workoutType: 'PULL',
      focus: 'Back & Biceps',
      exercises: [
        {
          name: 'Deadlift', sets: 3, reps: '5', rpe: 8,
          primaryMuscle: 'BACK', equipment: 'BARBELL', category: 'COMPOUND',
        },
      ],
    },
  ],
};

const progression = [
  { weekNumber: 1, setsDelta: 0, repsDelta: 0, rpeDelta: 0, note: 'Baseline' },
  { weekNumber: 2, setsDelta: 0, repsDelta: 1, rpeDelta: 0, note: 'Add a rep' },
  { weekNumber: 3, setsDelta: 1, repsDelta: 1, rpeDelta: 1, note: 'Add a set' },
  { weekNumber: 4, setsDelta: -1, repsDelta: -2, rpeDelta: -3, note: 'Deload' },
];
const weeks = expandProgram(template, progression, 4);

eq('week count', weeks.length, 4);
eq('weekNumbers', weeks.map((w) => w.weekNumber), [1, 2, 3, 4]);
eq('days per week preserved', weeks.map((w) => w.days.length), [2, 2, 2, 2]);
eq(
  'day identity preserved',
  weeks[0].days.map((d) => [d.dayOfWeek, d.workoutType, d.focus]),
  [[1, 'PUSH', 'Chest & Triceps'], [3, 'PULL', 'Back & Biceps']],
);
const ex = (w, d, i) => weeks[w].days[d].exercises[i];
eq('w1 is the template', [ex(0, 0, 0).sets, ex(0, 0, 0).reps, ex(0, 0, 0).rpe], [4, '6-8', 8]);
eq('w2 reps+1', [ex(1, 0, 0).sets, ex(1, 0, 0).reps], [4, '7-9']);
eq('w3 sets+1 reps+1 rpe+1', [ex(2, 0, 0).sets, ex(2, 0, 0).reps, ex(2, 0, 0).rpe], [5, '7-9', 9]);
eq('w4 deload', [ex(3, 0, 0).sets, ex(3, 0, 0).reps, ex(3, 0, 0).rpe], [3, '4-6', 5]);
eq(
  'exercise metadata carried through',
  [ex(3, 0, 0).primaryMuscle, ex(3, 0, 0).equipment, ex(3, 0, 0).category, ex(3, 0, 0).notes],
  ['CHEST', 'BARBELL', 'COMPOUND', 'stretch at bottom'],
);
eq('single-rep exercise shifts', ex(1, 1, 0).reps, '6');
eq(
  'sets never below 1',
  expandProgram(template, [{ weekNumber: 1, setsDelta: -99 }], 1)[0].days[0].exercises[0].sets,
  1,
);

// Robustness against sloppy model output.
eq('empty progression padded to duration', expandProgram(template, [], 8).length, 8);
eq(
  'empty progression = template repeated',
  expandProgram(template, [], 8)[7].days[0].exercises[0].reps,
  '6-8',
);
eq('short progression padded', expandProgram(template, [{ weekNumber: 1, repsDelta: 0 }], 6).length, 6);
eq(
  'out-of-order progression matched by weekNumber',
  expandProgram(template, [{ weekNumber: 2, repsDelta: 5 }, { weekNumber: 1, repsDelta: 0 }], 2)[1]
    .days[0].exercises[0].reps,
  '11-13',
);
eq(
  'garbage deltas ignored',
  expandProgram(template, [{ weekNumber: 1, setsDelta: 'lots', repsDelta: null, rpeDelta: {} }], 1)[0]
    .days[0].exercises[0].sets,
  4,
);
eq(
  'missing sets defaults to 3',
  expandProgram({ days: [{ dayOfWeek: 1, exercises: [{ name: 'X' }] }] }, [], 1)[0].days[0]
    .exercises[0].sets,
  3,
);
eq(
  'day with no exercises survives',
  expandProgram({ days: [{ dayOfWeek: 2 }] }, [], 1)[0].days[0].exercises,
  [],
);
eq('24 weeks expands', expandProgram(template, [], 24).length, 24);

// Regression: an 8-week program whose rpeDelta saturates must not pin every
// exercise at RPE 10 (the originally reported symptom).
const ramp = Array.from({ length: 8 }, (_, i) => ({
  weekNumber: i + 1, setsDelta: 0, repsDelta: 0, rpeDelta: Math.min(2, i),
}));
const ramped = expandProgram(template, ramp, 8);
const benchRpe = ramped.map((w) => w.days[0].exercises[0].rpe);
const flyRpe = ramped.map((w) => w.days[0].exercises[1].rpe);
eq('bench never reaches RPE 10', benchRpe.some((r) => r >= 10), false);
eq('bench caps at 9', Math.max(...benchRpe), 9);
eq('fly caps at 9', Math.max(...flyRpe), 9);
eq('week 1 equals template', [benchRpe[0], flyRpe[0]], [8, 7]);
eq('per-exercise RPE difference preserved early', benchRpe[1] > flyRpe[1], true);

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
