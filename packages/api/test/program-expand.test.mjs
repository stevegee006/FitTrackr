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
  clampLoadMultiplier,
  normaliseName,
  RPE_CEILING,
  MAX_RPE_RISE,
  MIN_LOAD_MULTIPLIER,
  MAX_LOAD_MULTIPLIER,
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

// ─── Sparse per-week overrides ────────────────────────────────────────────────
// The progression used to be three integers applied uniformly, so every week
// was week one with a set bolted on while the model's real intent sat unread
// in prose. These cover the fields that make the intent act.

eq('load multiplier constants', [MIN_LOAD_MULTIPLIER, MAX_LOAD_MULTIPLIER], [0.5, 1.5]);
eq('1.0 is not stored', clampLoadMultiplier(1), undefined);
eq('0.875 kept', clampLoadMultiplier(0.875), 0.875);
eq('absurdly low clamped', clampLoadMultiplier(0.1), 0.5);
eq('absurdly high clamped', clampLoadMultiplier(9), 1.5);
eq('garbage ignored', clampLoadMultiplier('heavy'), undefined);
eq('zero ignored', clampLoadMultiplier(0), undefined);
eq('negative ignored', clampLoadMultiplier(-1), undefined);

eq('name match forgives case and spacing', normaliseName('  Barbell   BENCH Press '), 'barbell bench press');

// "Add a working set to the compounds only" — the case that could not be said.
const compoundsOnly = expandProgram(template, [
  { weekNumber: 1, setsDelta: 0, repsDelta: 0, rpeDelta: 0,
    exercises: [{ name: 'barbell bench press', sets: 5 }] },
], 1)[0].days[0].exercises;
eq('override raises the named exercise', compoundsOnly[0].sets, 5);
eq('unnamed exercise untouched', compoundsOnly[1].sets, template.days[0].exercises[1].sets);

// Overrides are absolute, not deltas — a uniform delta must not be added on top.
const absolute = expandProgram(template, [
  { weekNumber: 1, setsDelta: 2, repsDelta: 0, rpeDelta: 0,
    exercises: [{ name: 'Barbell Bench Press', sets: 5 }] },
], 1)[0].days[0].exercises;
eq('override is absolute, not 4+2 then 5', absolute[0].sets, 5);
eq('delta still applies to the rest', absolute[1].sets, template.days[0].exercises[1].sets + 2);

// An overridden RPE is an EXPLICIT value, so it passes through exactly like a
// template RPE does — the ceiling exists to stop upward DRIFT from deltas, not
// to overrule a number the coach stated. Asserted so the two stay consistent:
// if one is ever capped, the other must be too.
const overRpe = expandProgram(template, [
  { weekNumber: 1, setsDelta: 0, repsDelta: 0, rpeDelta: 0,
    exercises: [{ name: 'Barbell Bench Press', rpe: 10 }] },
], 1)[0].days[0].exercises;
eq('explicit override RPE passes through, as a template RPE does', overRpe[0].rpe, clampRpe(10, 0));
// But an override must not become a new base that rpeDelta then climbs from.
const overRpeRamp = expandProgram(template, [
  { weekNumber: 1, setsDelta: 0, repsDelta: 0, rpeDelta: 3,
    exercises: [{ name: 'Barbell Bench Press', rpe: 8 }] },
], 1)[0].days[0].exercises;
eq('rpeDelta is not added on top of an override', overRpeRamp[0].rpe, 8);

// Reps and notes override too, and a week note beats the template's.
const repsNote = expandProgram(template, [
  { weekNumber: 1, setsDelta: 0, repsDelta: 5, rpeDelta: 0,
    exercises: [{ name: 'Barbell Bench Press', reps: '3-5', notes: 'heavy triple' }] },
], 1)[0].days[0].exercises;
eq('reps override wins over repsDelta', repsNote[0].reps, '3-5');
eq('week note replaces template note', repsNote[0].notes, 'heavy triple');
eq('template note kept where not overridden', repsNote[1].notes, template.days[0].exercises[1].notes);

// An exercise the template does not have is ignored, not invented.
const unknown = expandProgram(template, [
  { weekNumber: 1, exercises: [{ name: 'Zercher Squat', sets: 9 }] },
], 1)[0].days[0].exercises;
eq('unknown override adds nothing', unknown.length, template.days[0].exercises.length);

// Deload metadata rides on the week, since the template carries no weights.
const deload = expandProgram(template, [
  { weekNumber: 1, setsDelta: -1, repsDelta: -2, rpeDelta: -2, isDeload: true, loadMultiplier: 0.875,
    note: 'Deload' },
], 1)[0];
eq('deload flag on the week', deload.isDeload, true);
eq('load multiplier on the week', deload.loadMultiplier, 0.875);
eq('week note carried', deload.note, 'Deload');
eq('deload cuts sets', deload.days[0].exercises[0].sets, template.days[0].exercises[0].sets - 1);

// A plain week stays clean — absent flags rather than false/1.0 noise.
const plain = expandProgram(template, [{ weekNumber: 1 }], 1)[0];
eq('no deload key when not a deload', 'isDeload' in plain, false);
eq('no loadMultiplier key at 1.0', 'loadMultiplier' in plain, false);

// Back-compat: the old three-integer shape must behave exactly as before.
const legacy = expandProgram(template, [
  { weekNumber: 1, setsDelta: 1, repsDelta: 2, rpeDelta: 1 },
], 1)[0].days[0].exercises;
eq('legacy sets', legacy[0].sets, template.days[0].exercises[0].sets + 1);
eq('legacy reps', legacy[0].reps, '8-10');
eq('legacy rpe', legacy[0].rpe, 9);

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
