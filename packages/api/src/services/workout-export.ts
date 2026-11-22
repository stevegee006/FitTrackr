/**
 * Workout history as CSV, one row per SET.
 *
 * The export used to be one row per workout — name, type, duration, notes and
 * a "Sets" column that read the set count off a payload that never contained
 * sets, so it was `0` on every row of every export ever produced. None of the
 * training was in there: no exercise, no reps, no load.
 *
 * Built here rather than in the browser because this is the only half of the
 * codebase with tests. A CSV writer is exactly the kind of code that looks
 * right and quietly mangles one field in a hundred.
 */

const LB_PER_KG = 2.20462;

export type ExportUnits = 'METRIC' | 'IMPERIAL';

/**
 * One row per set, with the workout's own fields repeated across its rows.
 *
 * Flat and redundant on purpose: a spreadsheet pivots this, and every tool
 * that reads workout CSVs expects to find the date and the exercise on the
 * same line as the reps.
 */
export function workoutCsvHeaders(units: ExportUnits): string[] {
  return [
    'Date',
    'Workout',
    'Type',
    'Exercise',
    'Set',
    'Warmup',
    'Reps',
    units === 'IMPERIAL' ? 'Weight (lb)' : 'Weight (kg)',
    'RPE',
    'Duration (s)',
    'Distance (m)',
    'Completed',
    'Set Notes',
    'Workout Duration (min)',
    'Workout Notes',
  ];
}

/**
 * Quote a field for CSV.
 *
 * Quotes anything containing a comma, a quote, a newline OR a leading or
 * trailing space — Excel eats the spaces otherwise and an exercise name comes
 * back subtly different from the one that went out, which matters when the
 * file is re-imported and matched by name.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '') return '';
  const needsQuotes =
    str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')
    || str !== str.trim();
  return needsQuotes ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Kilograms in, the athlete's own unit out, to one decimal. */
export function displayWeight(weightKg: number | null | undefined, units: ExportUnits): string {
  if (weightKg == null) return '';
  const value = units === 'IMPERIAL' ? weightKg * LB_PER_KG : weightKg;
  return String(Math.round(value * 10) / 10);
}

/** A workout as the export query returns it. Loose by design — this is a view. */
export interface ExportWorkout {
  logDate: Date | string;
  name?: string | null;
  workoutType?: string | null;
  durationMin?: number | null;
  notes?: string | null;
  sets?: Array<{
    setNumber?: number | null;
    reps?: number | null;
    weightKg?: number | null;
    rpe?: number | null;
    durationSec?: number | null;
    distanceM?: number | null;
    isWarmup?: boolean | null;
    isCompleted?: boolean | null;
    notes?: string | null;
    exercise?: { name?: string | null } | null;
  }> | null;
}

/** YYYY-MM-DD, which is what every spreadsheet and importer agrees on. */
function isoDate(value: Date | string): string {
  const str = value instanceof Date ? value.toISOString() : String(value);
  return str.split('T')[0] ?? '';
}

export function buildWorkoutCsv(workouts: ExportWorkout[], units: ExportUnits): string {
  // Unknown rather than string: cells are numbers, booleans and nulls until
  // csvCell renders them, and coercing early loses the null/0 distinction the
  // tests pin down.
  const rows: unknown[][] = [workoutCsvHeaders(units)];

  for (const w of workouts) {
    const date = isoDate(w.logDate);
    const common = [date, w.name ?? '', w.workoutType ?? ''];
    const trailing = [w.durationMin ?? '', w.notes ?? ''];
    const sets = w.sets ?? [];

    // A workout with no sets still gets a line. A rest day that was logged,
    // or a HealthKit walk that carries its distance on the workout rather
    // than on sets, would otherwise vanish from the export entirely — and an
    // export that silently drops rows is worse than one that is merely
    // sparse.
    if (sets.length === 0) {
      rows.push([...common, '', '', '', '', '', '', '', '', '', '', ...trailing]);
      continue;
    }

    for (const s of sets) {
      rows.push([
        ...common,
        s.exercise?.name ?? '',
        s.setNumber ?? '',
        s.isWarmup ? 'Yes' : 'No',
        s.reps ?? '',
        displayWeight(s.weightKg, units),
        s.rpe ?? '',
        s.durationSec ?? '',
        s.distanceM ?? '',
        s.isCompleted ? 'Yes' : 'No',
        s.notes ?? '',
        ...trailing,
      ]);
    }
  }

  // CRLF: the line ending the CSV spec names, and the one Excel wants.
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
