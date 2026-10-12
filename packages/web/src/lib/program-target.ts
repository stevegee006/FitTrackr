/**
 * What a program's "reps" field actually means.
 *
 * The AI writes targets as free text — "12", "8-12", "20 min", "250 m",
 * "30 m", "400m", "30s" — because a Hyrox block is distance and time, not
 * reps. The program format has no unit field, so the whole thing arrives as
 * one string.
 *
 * Until 2026-10-12 every one of those was run through `parseInt` and stored as
 * a rep count, which is how a 20-minute Zone 2 run became "20 reps" and a
 * 250 m row became "250 reps". The programs page then appended the word
 * "reps" to a value that already carried its own unit, producing
 * "4 sets × 20 m reps".
 *
 * Note `m` is METRES and `min` is MINUTES, which is why the suffix table is
 * matched longest-first — "20 min" read as metres is a silent, plausible-
 * looking wrong answer.
 */

export interface ProgramTarget {
  /** Rep count to seed the set with, or null when the target is not reps. */
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  /** The upper end of a range ("8-12" → 12), for the rep-range preference. */
  repsMax: number | null;
  /**
   * How to render it, unit included and never with "reps" bolted on. Falls
   * back to the raw text so "AMRAP" survives intact.
   */
  label: string;
}

const M_PER_MILE = 1609.344;
const M_PER_YARD = 0.9144;

/** Longest suffix first: `min` must beat `mi`, and `km` must beat `m`. */
const UNITS: Array<{ re: RegExp; to: (n: number) => Partial<ProgramTarget>; unit: string }> = [
  { re: /^(minutes?|mins?)$/i,      unit: 'min', to: (n) => ({ durationSec: Math.round(n * 60) }) },
  { re: /^(seconds?|secs?|s)$/i,    unit: 's',   to: (n) => ({ durationSec: Math.round(n) }) },
  { re: /^(hours?|hrs?|h)$/i,       unit: 'h',   to: (n) => ({ durationSec: Math.round(n * 3600) }) },
  { re: /^(kilometers?|kilometres?|km)$/i, unit: 'km', to: (n) => ({ distanceM: n * 1000 }) },
  { re: /^(miles?|mi)$/i,           unit: 'mi',  to: (n) => ({ distanceM: n * M_PER_MILE }) },
  { re: /^(yards?|yds?|yd)$/i,      unit: 'yd',  to: (n) => ({ distanceM: n * M_PER_YARD }) },
  { re: /^(meters?|metres?|m)$/i,   unit: 'm',   to: (n) => ({ distanceM: n }) },
];

const EMPTY: ProgramTarget = { reps: null, durationSec: null, distanceM: null, repsMax: null, label: '' };

export function parseProgramTarget(raw: unknown): ProgramTarget {
  const text = String(raw ?? '').trim();
  if (!text) return { ...EMPTY };

  // "mm:ss" — a plain clock time, which no unit suffix would catch.
  const clock = text.match(/^(\d+):([0-5]\d)$/);
  if (clock) {
    const sec = parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
    return { ...EMPTY, durationSec: sec, label: text };
  }

  // A leading number (or range) followed by an optional unit.
  const m = text.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*([a-zA-Z]*)\.?$/);
  if (!m) {
    // "AMRAP", "to failure", anything else the model invented. Keep the words.
    return { ...EMPTY, label: text };
  }

  const lo = parseFloat(m[1]);
  const hi = m[2] != null ? parseFloat(m[2]) : null;
  const suffix = (m[3] ?? '').trim();

  if (!suffix) {
    // Bare number or range — reps, the ordinary case.
    const reps = Math.max(0, Math.round(lo));
    const repsMax = hi != null ? Math.max(reps, Math.round(hi)) : null;
    return {
      ...EMPTY,
      reps,
      repsMax,
      label: repsMax != null && repsMax !== reps ? `${reps}–${repsMax} reps` : `${reps} reps`,
    };
  }

  const unit = UNITS.find((u) => u.re.test(suffix));
  if (!unit) {
    // An unrecognised suffix is NOT silently treated as reps — that is the bug
    // this file exists to stop. Keep the text, seed nothing.
    return { ...EMPTY, label: text };
  }

  // A range with a unit ("20-30 min") seeds from the bottom, matching how a
  // rep range seeds the set with its lower bound.
  return { ...EMPTY, ...unit.to(lo), label: `${trimNum(lo)}${hi != null ? `–${trimNum(hi)}` : ''} ${unit.unit}` };
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
