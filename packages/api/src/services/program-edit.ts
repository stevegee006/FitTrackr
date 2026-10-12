import { normaliseName } from './program-expand.js';

/**
 * Edits to a generated program, as data.
 *
 * Programs were immutable once generated: there was no PATCH at all, so
 * swapping a cable fly for a pec deck meant regenerating the whole block and
 * losing every other thing the model got right.
 *
 * The vocabulary is deliberately small and deliberately DECLARATIVE. Two
 * callers share it — a human pressing "switch" in the program view, and (next)
 * the AI being asked "swap the cable fly for the pec deck in every week". The
 * model never rewrites `programData` itself; it emits these, which are applied
 * by code that can be tested, bounded and shown as a preview before anything
 * is saved. A model handed the whole JSON would return a whole JSON, and any
 * silent corruption in the other seven weeks would be invisible.
 *
 * `weeks` omitted means EVERY week, which is the common case — "for each week"
 * is how people describe a program change.
 */
export type ProgramEdit =
  | {
      op: 'replaceExercise';
      /** Matched against the template name, forgiving case and spacing. */
      from: string;
      to: {
        name: string;
        primaryMuscle?: string;
        equipment?: string;
        category?: string;
      };
      weeks?: number[];
    }
  | {
      op: 'setExerciseFields';
      name: string;
      sets?: number;
      reps?: string;
      rpe?: number;
      notes?: string;
      weeks?: number[];
    }
  | { op: 'removeExercise'; name: string; weeks?: number[] }
  | { op: 'setWeekNote'; weekNumber: number; note: string };

export interface AppliedEdit {
  op: ProgramEdit['op'];
  /** How many exercise entries (or weeks, for a note) the edit touched. */
  matched: number;
  /** Set when an edit matched nothing, so the caller can say so rather than reporting success. */
  warning?: string;
}

export interface ProgramEditResult {
  data: any;
  applied: AppliedEdit[];
}

/** Does this edit apply to the given week? */
function inScope(weeks: number[] | undefined, weekNumber: number): boolean {
  if (!Array.isArray(weeks) || weeks.length === 0) return true;
  return weeks.includes(weekNumber);
}

/**
 * Apply edits to a `ProgramData`, returning a NEW object.
 *
 * Pure and non-mutating: the caller holds the original until the result is
 * saved, so a half-applied edit cannot be what gets written. Unknown ops and
 * edits that match nothing are reported rather than thrown — one bad
 * instruction in a batch should not discard the good ones, and the caller
 * surfaces the warnings.
 */
export function applyProgramEdits(programData: any, edits: ProgramEdit[]): ProgramEditResult {
  const weeks: any[] = Array.isArray(programData?.weeks) ? programData.weeks : [];
  // Structured clone of just what we rewrite. JSON round-trip is safe here:
  // ProgramData is plain JSON by construction, straight out of the model.
  let next: any = { ...programData, weeks: JSON.parse(JSON.stringify(weeks)) };
  const applied: AppliedEdit[] = [];

  for (const edit of edits) {
    let matched = 0;

    switch (edit.op) {
      case 'replaceExercise': {
        const from = normaliseName(edit.from);
        for (const week of next.weeks) {
          if (!inScope(edit.weeks, Number(week?.weekNumber))) continue;
          for (const day of week?.days ?? []) {
            for (const ex of day?.exercises ?? []) {
              if (normaliseName(ex?.name) !== from) continue;
              ex.name = edit.to.name;
              // Only overwrite the classification fields the caller supplied.
              // A swap that named no muscle should not blank the old one and
              // drop the exercise out of the volume rings.
              if (edit.to.primaryMuscle) ex.primaryMuscle = edit.to.primaryMuscle;
              if (edit.to.equipment) ex.equipment = edit.to.equipment;
              if (edit.to.category) ex.category = edit.to.category;
              matched++;
            }
          }
        }
        break;
      }

      case 'setExerciseFields': {
        const name = normaliseName(edit.name);
        for (const week of next.weeks) {
          if (!inScope(edit.weeks, Number(week?.weekNumber))) continue;
          for (const day of week?.days ?? []) {
            for (const ex of day?.exercises ?? []) {
              if (normaliseName(ex?.name) !== name) continue;
              if (edit.sets !== undefined) ex.sets = Math.max(1, Math.trunc(edit.sets));
              if (edit.reps !== undefined) ex.reps = String(edit.reps);
              // Same ceiling the expander enforces, so an edit cannot route
              // around the rule that a program never sits at RPE 10.
              if (edit.rpe !== undefined) ex.rpe = Math.max(1, Math.min(10, edit.rpe));
              if (edit.notes !== undefined) ex.notes = edit.notes;
              matched++;
            }
          }
        }
        break;
      }

      case 'removeExercise': {
        const name = normaliseName(edit.name);
        for (const week of next.weeks) {
          if (!inScope(edit.weeks, Number(week?.weekNumber))) continue;
          for (const day of week?.days ?? []) {
            if (!Array.isArray(day?.exercises)) continue;
            const before = day.exercises.length;
            day.exercises = day.exercises.filter((ex: any) => normaliseName(ex?.name) !== name);
            matched += before - day.exercises.length;
          }
        }
        break;
      }

      case 'setWeekNote': {
        for (const week of next.weeks) {
          if (Number(week?.weekNumber) !== Number(edit.weekNumber)) continue;
          week.note = edit.note;
          matched++;
        }
        break;
      }

      default: {
        applied.push({
          op: (edit as any)?.op ?? ('unknown' as any),
          matched: 0,
          warning: `Unknown operation "${(edit as any)?.op}" — ignored.`,
        });
        continue;
      }
    }

    applied.push({
      op: edit.op,
      matched,
      // A swap that matched nothing is the interesting failure: a misspelt
      // name reports success and changes nothing, and the athlete finds out
      // weeks later at the rack.
      ...(matched === 0 ? { warning: 'Matched no exercises — check the name.' } : {}),
    });
  }

  return { data: next, applied };
}
