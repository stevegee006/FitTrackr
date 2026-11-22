/**
 * Tests for the workout CSV export.
 *
 * The export it replaces reported "Sets: 0" on every row of every file,
 * because it read a set count off a payload that carried no sets. Nothing
 * caught that, so these lean hard on the actual contents of the output
 * rather than on it merely being produced.
 */
import {
  buildWorkoutCsv,
  csvCell,
  displayWeight,
  workoutCsvHeaders,
} from '../dist/services/workout-export.js';

let pass = 0;
const failures = [];

function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else failures.push(`${label}\n    got  ${g}\n    want ${w}`);
}

const lines = (csv) => csv.split('\r\n');
const cells = (line) => {
  // A real parser, because asserting with split(',') would pass on exactly the
  // quoting bugs these tests exist to catch.
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

// ─── csvCell ──────────────────────────────────────────────────────────────────
eq('plain value unquoted', csvCell('Bench Press'), 'Bench Press');
eq('comma quoted', csvCell('Squat, high bar'), '"Squat, high bar"');
eq('quote doubled', csvCell('say "hi"'), '"say ""hi"""');
eq('newline quoted', csvCell('one\ntwo'), '"one\ntwo"');
// Excel strips unquoted leading/trailing spaces, which silently renames an
// exercise on re-import.
eq('leading space quoted', csvCell(' Bench'), '" Bench"');
eq('trailing space quoted', csvCell('Bench '), '"Bench "');
eq('null is empty', csvCell(null), '');
eq('undefined is empty', csvCell(undefined), '');
eq('zero is kept, not blanked', csvCell(0), '0');
eq('false is kept', csvCell(false), 'false');

// ─── displayWeight ────────────────────────────────────────────────────────────
eq('metric passes through', displayWeight(60, 'METRIC'), '60');
eq('imperial converts', displayWeight(100, 'IMPERIAL'), '220.5');
eq('one decimal', displayWeight(62.5, 'METRIC'), '62.5');
eq('null weight is empty, not zero', displayWeight(null, 'METRIC'), '');
eq('zero weight is kept', displayWeight(0, 'METRIC'), '0');

// ─── headers ──────────────────────────────────────────────────────────────────
eq('metric header names kg', workoutCsvHeaders('METRIC')[7], 'Weight (kg)');
eq('imperial header names lb', workoutCsvHeaders('IMPERIAL')[7], 'Weight (lb)');

// ─── buildWorkoutCsv ──────────────────────────────────────────────────────────
const workout = {
  logDate: new Date('2026-11-20T00:00:00Z'),
  name: 'Chest & shoulder strength',
  workoutType: 'PUSH',
  durationMin: 72,
  notes: 'felt strong',
  sets: [
    { setNumber: 1, reps: 10, weightKg: 60, rpe: 8, isWarmup: false, isCompleted: true, notes: 'easy', exercise: { name: 'Barbell Bench Press' } },
    { setNumber: 2, reps: 8, weightKg: 65, rpe: 9, isWarmup: false, isCompleted: true, exercise: { name: 'Barbell Bench Press' } },
    { setNumber: 1, reps: 12, weightKg: 20, isWarmup: true, isCompleted: false, exercise: { name: 'Cable Chest Fly' } },
  ],
};

{
  const csv = buildWorkoutCsv([workout], 'METRIC');
  const rows = lines(csv);
  // THE regression: one line per set, not one per workout.
  eq('header plus one row per set', rows.length, 4);

  const r1 = cells(rows[1]);
  eq('date', r1[0], '2026-11-20');
  eq('workout name', r1[1], 'Chest & shoulder strength');
  eq('type', r1[2], 'PUSH');
  eq('exercise name present', r1[3], 'Barbell Bench Press');
  eq('set number', r1[4], '1');
  eq('warmup flag', r1[5], 'No');
  eq('reps present', r1[6], '10');
  eq('weight present', r1[7], '60');
  eq('rpe present', r1[8], '8');
  eq('completed', r1[11], 'Yes');
  eq('set note', r1[12], 'easy');
  eq('workout duration repeats on the row', r1[13], '72');
  eq('workout note repeats on the row', r1[14], 'felt strong');

  const r3 = cells(rows[3]);
  eq('warmup row flagged', r3[5], 'Yes');
  eq('incomplete row flagged', r3[11], 'No');
  eq('missing rpe is empty, not 0', r3[8], '');
}

// Imperial converts the load and says so in the header.
{
  const rows = lines(buildWorkoutCsv([workout], 'IMPERIAL'));
  eq('imperial header', cells(rows[0])[7], 'Weight (lb)');
  eq('imperial weight converted', cells(rows[1])[7], '132.3');
}

// Cardio: duration and distance, no reps or load.
{
  const rows = lines(buildWorkoutCsv([{
    logDate: '2026-11-21T00:00:00.000Z',
    name: 'Outdoor Walk',
    workoutType: 'CARDIO',
    sets: [{ setNumber: 1, durationSec: 1200, distanceM: 1557.4, exercise: { name: 'Walking' } }],
  }], 'METRIC'));
  const r = cells(rows[1]);
  eq('duration exported', r[9], '1200');
  eq('distance exported', r[10], '1557.4');
  eq('reps blank for cardio', r[6], '');
  eq('weight blank for cardio', r[7], '');
}

// A workout with no sets still produces a line — an export that silently
// drops rows is worse than one that is sparse.
{
  const rows = lines(buildWorkoutCsv([{ logDate: '2026-11-22', name: 'Rest day note', workoutType: 'CUSTOM', notes: 'tweaked shoulder' }], 'METRIC'));
  eq('setless workout still a row', rows.length, 2);
  const r = cells(rows[1]);
  eq('its name survives', r[1], 'Rest day note');
  eq('its exercise column is blank', r[3], '');
  eq('its note survives', r[14], 'tweaked shoulder');
}

// Quoting survives a round trip through a real parser.
{
  const rows = lines(buildWorkoutCsv([{
    logDate: '2026-11-22',
    name: 'Legs, heavy',
    workoutType: 'LEGS',
    notes: 'said "go again"',
    sets: [{ setNumber: 1, reps: 5, weightKg: 100, exercise: { name: 'Squat, high bar' } }],
  }], 'METRIC'));
  const r = cells(rows[1]);
  eq('comma in workout name round-trips', r[1], 'Legs, heavy');
  eq('comma in exercise name round-trips', r[3], 'Squat, high bar');
  eq('quotes in notes round-trip', r[14], 'said "go again"');
  eq('column count unchanged by quoting', r.length, workoutCsvHeaders('METRIC').length);
}

// Every row has the same number of columns — a ragged CSV breaks every reader.
{
  const rows = lines(buildWorkoutCsv([workout, { logDate: '2026-11-22', name: 'Empty' }], 'METRIC'));
  const width = workoutCsvHeaders('METRIC').length;
  const widths = rows.map((r) => cells(r).length);
  eq('all rows same width', widths.every((w) => w === width), true);
}

// Empty input is a header and nothing else, not a crash.
{
  const csv = buildWorkoutCsv([], 'METRIC');
  eq('empty export is header only', lines(csv).length, 1);
}

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
