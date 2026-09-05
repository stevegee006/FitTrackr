/**
 * Tests for the pure parts of applying an AI next-week plan to real dates.
 * Run via `pnpm --filter @fittrackr/api test`.
 *
 * Both helpers read MODEL OUTPUT, so the cases that matter are the ones where
 * it does not follow instructions: a day labelled "Day 3" instead of "Wed", a
 * rep range where a number was asked for, an empty string. Getting these wrong
 * writes workouts onto the wrong dates, which is worse than refusing.
 */
import { dayOffsetFromLabel, repsFromString, claimOffset } from '../dist/services/plan-apply.js';

let pass = 0;
const failures = [];
function eq(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else failures.push(`${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
}

// ─── dayOffsetFromLabel ───────────────────────────────────────────────────────
// Mon=0 … Sun=6, because the plan's week starts on the Monday that
// lib/streak.ts computes.
eq('Mon', dayOffsetFromLabel('Mon', 0), 0);
eq('Tue', dayOffsetFromLabel('Tue', 0), 1);
eq('Wed', dayOffsetFromLabel('Wed', 0), 2);
eq('Thu', dayOffsetFromLabel('Thu', 0), 3);
eq('Fri', dayOffsetFromLabel('Fri', 0), 4);
eq('Sat', dayOffsetFromLabel('Sat', 0), 5);
eq('Sun', dayOffsetFromLabel('Sun', 0), 6);

eq('full name', dayOffsetFromLabel('Wednesday', 0), 2);
eq('lowercase', dayOffsetFromLabel('friday', 0), 4);
eq('padded', dayOffsetFromLabel('  Sat  ', 0), 5);

// The model is told to use "Mon"; it will sometimes number the days instead.
eq('Day 1 is Monday, not Tuesday', dayOffsetFromLabel('Day 1', 0), 0);
eq('Day 3', dayOffsetFromLabel('Day 3', 0), 2);
eq('bare number', dayOffsetFromLabel('5', 0), 4);
eq('Day 7 is Sunday', dayOffsetFromLabel('Day 7', 0), 6);
// Out of range falls through to running order rather than landing off-week.
eq('Day 9 falls back to position', dayOffsetFromLabel('Day 9', 3), 3);
eq('Day 0 falls back to position', dayOffsetFromLabel('Day 0', 2), 2);

// Anything unrecognised keeps the plan's own ordering.
eq('unrecognised uses position', dayOffsetFromLabel('Session A', 2), 2);
eq('empty uses position', dayOffsetFromLabel('', 1), 1);
// ...but never off the end of the week, which would silently write into the
// week after next.
eq('position is capped at Sunday', dayOffsetFromLabel('???', 12), 6);

// A day name always wins over a number in the same string.
eq('"Mon (day 4)" is Monday', dayOffsetFromLabel('Mon (day 4)', 0), 0);

// ─── repsFromString ───────────────────────────────────────────────────────────
// A range means "start at the bottom" — the top is what you progress toward,
// so prefilling the top would have the athlete start where they should finish.
eq('range takes the low end', repsFromString('6-8'), 6);
eq('en-dash range', repsFromString('8–12'), 8);
eq('single number', repsFromString('8'), 8);
eq('with text', repsFromString('10 reps'), 10);
eq('AMRAP-ish text with a number', repsFromString('8+ reps'), 8);

// No number at all is null, not 0: a set with 0 reps counts toward set totals
// while contributing nothing, whereas null reads as "not prescribed".
eq('no digits is null', repsFromString('AMRAP'), null);
eq('empty is null', repsFromString(''), null);
eq('zero is null', repsFromString('0'), null);
eq('absurd is null', repsFromString('99999'), null);

// ─── claimOffset ──────────────────────────────────────────────────────────────
// Two days landing on one date silently loses a session. This is reachable
// WITHOUT duplicate labels, via the fallback path above: ["Tue", "Session B"]
// puts day 0 on offset 1 and day 1 on fallback index 1.
{
  const used = new Set();
  eq('first day takes its own slot', claimOffset(1, used), 1);
  eq('collision slides forward', claimOffset(1, used), 2);
  eq('and again', claimOffset(1, used), 3);
  eq('used set tracks all three', [...used].sort(), [1, 2, 3]);
}
{
  // A day at the end of the week wraps BACKWARDS rather than off the week —
  // an offset of 7 would write into the week after next.
  const used = new Set([5, 6]);
  eq('end of week wraps backwards', claimOffset(6, used), 4);
}
{
  const used = new Set([0, 1, 2, 3, 4, 5]);
  eq('last free slot is found', claimOffset(0, used), 6);
}
{
  // Every day taken: null, so the caller skips rather than doubling up.
  const used = new Set([0, 1, 2, 3, 4, 5, 6]);
  eq('full week gives up', claimOffset(3, used), null);
}
{
  // No collision means no movement — the common case must be untouched.
  const used = new Set();
  eq('Mon', claimOffset(0, used), 0);
  eq('Wed', claimOffset(2, used), 2);
  eq('Fri', claimOffset(4, used), 4);
  eq('nothing moved', [...used].sort(), [0, 2, 4]);
}

// ─── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
