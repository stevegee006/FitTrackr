/**
 * Tests for program edits.
 *
 * These matter more than most: the same vocabulary is what the AI will emit
 * when asked to change a plan, so a bug here corrupts eight weeks of training
 * silently. No test framework — a plain node script with an exit code, run by
 * `pnpm --filter @fittrackr/api test`.
 */
import { applyProgramEdits } from '../dist/services/program-edit.js';

let pass = 0;
const failures = [];

function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else failures.push(`${label}\n    got  ${g}\n    want ${w}`);
}

const program = () => ({
  notes: 'overall',
  weeks: [1, 2, 3].map((n) => ({
    weekNumber: n,
    days: [
      {
        dayOfWeek: 1,
        workoutType: 'PUSH',
        focus: 'Chest',
        exercises: [
          { name: 'Barbell Bench Press', sets: 4, reps: '6-8', rpe: 8, primaryMuscle: 'CHEST', equipment: 'BARBELL', category: 'COMPOUND' },
          { name: 'Cable Chest Fly', sets: 3, reps: '12-15', rpe: 7, primaryMuscle: 'CHEST', equipment: 'CABLE', category: 'ISOLATION' },
        ],
      },
      {
        dayOfWeek: 3,
        workoutType: 'PULL',
        focus: 'Back',
        exercises: [
          { name: 'Cable Chest Fly', sets: 2, reps: '12-15', rpe: 7, primaryMuscle: 'CHEST', equipment: 'CABLE', category: 'ISOLATION' },
        ],
      },
    ],
  })),
});

// ─── replaceExercise ──────────────────────────────────────────────────────────
// The case this was built for: swap it everywhere, in one instruction.
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: 'Cable Chest Fly', to: { name: 'Pec Deck', equipment: 'MACHINE' } },
  ]);
  // 3 weeks x 2 days containing it = 6 entries.
  eq('replace across every week', applied[0].matched, 6);
  eq('no warning when it matched', applied[0].warning, undefined);
  eq('name swapped', data.weeks[0].days[0].exercises[1].name, 'Pec Deck');
  eq('equipment swapped', data.weeks[0].days[0].exercises[1].equipment, 'MACHINE');
  // Unsupplied classification must be KEPT, not blanked — an exercise with no
  // primaryMuscle drops out of the volume rings.
  eq('muscle kept when not supplied', data.weeks[2].days[1].exercises[0].primaryMuscle, 'CHEST');
  eq('sets and reps untouched', [data.weeks[0].days[0].exercises[1].sets, data.weeks[0].days[0].exercises[1].reps], [3, '12-15']);
  eq('other exercises untouched', data.weeks[0].days[0].exercises[0].name, 'Barbell Bench Press');
}

// Scoped to one week.
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: 'Cable Chest Fly', to: { name: 'Pec Deck' }, weeks: [2] },
  ]);
  eq('scoped match count', applied[0].matched, 2);
  eq('week 1 unchanged', data.weeks[0].days[0].exercises[1].name, 'Cable Chest Fly');
  eq('week 2 changed', data.weeks[1].days[0].exercises[1].name, 'Pec Deck');
  eq('week 3 unchanged', data.weeks[2].days[0].exercises[1].name, 'Cable Chest Fly');
}

// Name matching forgives case and spacing, as the expander's does.
{
  const { applied } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: '  cable   CHEST fly ', to: { name: 'Pec Deck' } },
  ]);
  eq('sloppy name still matches', applied[0].matched, 6);
}

// A name that matches nothing must SAY SO. Reporting success and changing
// nothing is how a typo is discovered weeks later at the rack.
{
  const { applied } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: 'Pec Deck', to: { name: 'Cable Chest Fly' } },
  ]);
  eq('no match is reported', applied[0].matched, 0);
  eq('no match warns', typeof applied[0].warning, 'string');
}

// ─── setExerciseFields ────────────────────────────────────────────────────────
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'setExerciseFields', name: 'Barbell Bench Press', sets: 5, reps: '5', weeks: [3] },
  ]);
  eq('fields applied to the named week only', applied[0].matched, 1);
  eq('sets set', data.weeks[2].days[0].exercises[0].sets, 5);
  eq('reps set', data.weeks[2].days[0].exercises[0].reps, '5');
  eq('earlier week untouched', data.weeks[0].days[0].exercises[0].sets, 4);
  eq('rpe untouched when not supplied', data.weeks[2].days[0].exercises[0].rpe, 8);
}

// RPE stays bounded, so an edit cannot route around the rule the expander
// enforces that a program never sits at 10 everywhere.
{
  const { data } = applyProgramEdits(program(), [
    { op: 'setExerciseFields', name: 'Barbell Bench Press', rpe: 99 },
  ]);
  eq('absurd rpe clamped', data.weeks[0].days[0].exercises[0].rpe, 10);
}
{
  const { data } = applyProgramEdits(program(), [
    { op: 'setExerciseFields', name: 'Barbell Bench Press', rpe: 0 },
  ]);
  eq('zero rpe floored', data.weeks[0].days[0].exercises[0].rpe, 1);
}
{
  const { data } = applyProgramEdits(program(), [
    { op: 'setExerciseFields', name: 'Barbell Bench Press', sets: 0 },
  ]);
  eq('zero sets floored to 1', data.weeks[0].days[0].exercises[0].sets, 1);
}

// ─── removeExercise ───────────────────────────────────────────────────────────
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'removeExercise', name: 'Cable Chest Fly' },
  ]);
  eq('removed everywhere', applied[0].matched, 6);
  eq('day 1 keeps the bench', data.weeks[0].days[0].exercises.map((e) => e.name), ['Barbell Bench Press']);
  eq('day 3 left empty, not deleted', data.weeks[0].days[1].exercises, []);
}

// ─── setWeekNote ──────────────────────────────────────────────────────────────
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'setWeekNote', weekNumber: 2, note: 'Deload — take it easy' },
  ]);
  eq('one week noted', applied[0].matched, 1);
  eq('note set', data.weeks[1].note, 'Deload — take it easy');
  eq('other weeks have none', data.weeks[0].note, undefined);
}

// ─── Safety ───────────────────────────────────────────────────────────────────
// Non-mutating: the caller holds the original until the result is saved, so a
// half-applied batch can never be what gets written.
{
  const original = program();
  applyProgramEdits(original, [{ op: 'replaceExercise', from: 'Cable Chest Fly', to: { name: 'Pec Deck' } }]);
  eq('input not mutated', original.weeks[0].days[0].exercises[1].name, 'Cable Chest Fly');
}

// One bad instruction must not discard the good ones.
{
  const { data, applied } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: 'Cable Chest Fly', to: { name: 'Pec Deck' } },
    { op: 'teleportExercise', name: 'whatever' },
    { op: 'setExerciseFields', name: 'Barbell Bench Press', sets: 5 },
  ]);
  eq('three results for three edits', applied.length, 3);
  eq('unknown op warns', typeof applied[1].warning, 'string');
  eq('edit before the bad one applied', data.weeks[0].days[0].exercises[1].name, 'Pec Deck');
  eq('edit after the bad one applied', data.weeks[0].days[0].exercises[0].sets, 5);
}

// Edits compose in order, last write winning.
{
  const { data } = applyProgramEdits(program(), [
    { op: 'replaceExercise', from: 'Cable Chest Fly', to: { name: 'Pec Deck' } },
    { op: 'setExerciseFields', name: 'Pec Deck', sets: 4 },
  ]);
  eq('second edit sees the first', data.weeks[0].days[0].exercises[1].sets, 4);
}

// Malformed input must not throw — a program with no weeks is still a program.
{
  const { applied } = applyProgramEdits({}, [{ op: 'replaceExercise', from: 'x', to: { name: 'y' } }]);
  eq('empty program survives', applied[0].matched, 0);
}
{
  const { data } = applyProgramEdits({ weeks: [{ weekNumber: 1 }] }, [
    { op: 'removeExercise', name: 'x' },
  ]);
  eq('week with no days survives', data.weeks.length, 1);
}
{
  const { applied } = applyProgramEdits(program(), []);
  eq('no edits is a no-op', applied, []);
}

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
