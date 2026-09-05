/**
 * Pure parsing for applying an AI next-week plan, kept out of
 * plan-apply.service.ts so it can be unit-tested without a database.
 *
 * The service imports `logger`, which pulls in `config/env` — and that
 * `process.exit(1)`s at import time when DATABASE_URL and friends are missing.
 * A test importing the service therefore dies before running an assertion.
 * Same split as workout-summary.ts vs workout.service.ts.
 *
 * Both functions read MODEL OUTPUT, so they are written for the cases where it
 * ignores the instructions rather than the happy path.
 */

/** Mon=0 … Sun=6. Accepts "Mon", "Monday", "monday", "Day 1", "1". */
export function dayOffsetFromLabel(label: string, fallbackIndex: number): number {
  const l = String(label ?? '').trim().toLowerCase();
  const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // A day name wins over any number in the same string: "Mon (day 4)" is Monday.
  const byName = names.findIndex((n) => l.startsWith(n));
  if (byName !== -1) return byName;

  // "Day 3" / "3" — 1-indexed in the model's own numbering.
  const num = l.match(/(\d+)/);
  if (num) {
    const n = parseInt(num[1], 10);
    if (n >= 1 && n <= 7) return n - 1;
  }

  // Unrecognised: keep the plan's own ordering, but never past Sunday — an
  // uncapped offset would silently write into the week after next.
  return Math.min(fallbackIndex, 6);
}

/**
 * "6-8" and "8" both mean "start at the bottom of the range".
 *
 * The top of a range is what you progress TOWARD, so prefilling it would have
 * the athlete start where they should finish. No number at all is null rather
 * than 0, because a set with 0 reps counts toward set totals while
 * contributing nothing, whereas null reads as "not prescribed".
 */
export function repsFromString(reps: string): number | null {
  const first = String(reps ?? '').match(/\d+/);
  if (!first) return null;
  const n = parseInt(first[0], 10);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
}

/**
 * Take the first free day at or after `preferred`, wrapping backwards if the
 * end of the week is full. Returns null only when all seven are taken.
 *
 * Two days can resolve to the same offset even when every label is distinct,
 * because an unrecognised label falls back to its running index: a plan of
 * ["Tue", "Session B"] puts day 0 on offset 1 and day 1 on fallback index 1,
 * so both land on Tuesday. Stacking them onto one date silently loses a
 * session, which is worse than moving one a day.
 *
 * Mutates `used`, so it is called only once a day is definitely being created
 * — a day skipped for having no matching exercises must not consume a slot.
 */
export function claimOffset(preferred: number, used: Set<number>): number | null {
  for (let o = preferred; o <= 6; o++) {
    if (!used.has(o)) { used.add(o); return o; }
  }
  for (let o = preferred - 1; o >= 0; o--) {
    if (!used.has(o)) { used.add(o); return o; }
  }
  return null;
}

export interface PlanDayInput {
  label: string;
  workoutType: string;
  focus: string;
  exercises: Array<{ name: string; sets: number; reps: string; load: number | null }>;
}
