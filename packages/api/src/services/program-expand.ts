/** Shift a reps value ("8" or "6-8") by a whole number, floor 1. */
export function shiftReps(reps: unknown, delta: number): string {
  const text = String(reps ?? '').trim();
  if (!delta) return text;
  const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const lo = Math.max(1, parseInt(range[1], 10) + delta);
    const hi = Math.max(lo, parseInt(range[2], 10) + delta);
    return `${lo}-${hi}`;
  }
  const single = text.match(/^(\d+)$/);
  if (single) return String(Math.max(1, parseInt(single[1], 10) + delta));
  return text; // e.g. "AMRAP", "30s" — leave alone
}

/**
 * RPE 10 is a true grinding max. A whole week of every exercise at 10 is not a
 * program, so upward progression is capped: never above RPE_CEILING, and never
 * more than MAX_RPE_RISE over whatever the template asked for. Progression is
 * meant to come mostly from reps and sets.
 */
export const RPE_CEILING = 9;
export const MAX_RPE_RISE = 2;

export function clampRpe(rpe: unknown, delta: number): number | undefined {
  if (typeof rpe !== 'number' || !Number.isFinite(rpe)) return undefined;
  // Template weeks (delta 0) and deloads (negative) pass through as designed —
  // the cap exists to stop upward drift, not to rewrite the coach's intent.
  if (delta <= 0) return Math.max(1, Math.min(10, Math.round(rpe + delta)));
  const ceiling = Math.min(RPE_CEILING, rpe + MAX_RPE_RISE);
  return Math.max(1, Math.min(ceiling, Math.round(rpe + delta)));
}

/**
 * Expand a one-week template + progression into the week-by-week `ProgramData`
 * shape the frontend already reads. Tolerant by design: a missing or short
 * progression is padded so generation never fails on model sloppiness.
 */
export function expandProgram(
  template: any,
  progression: any[],
  durationWeeks: number,
): Array<{ weekNumber: number; days: any[] }> {
  const templateDays: any[] = Array.isArray(template?.days) ? template.days : [];

  const steps = Array.from({ length: durationWeeks }, (_, i) => {
    const given = progression.find((p) => Number(p?.weekNumber) === i + 1) ?? progression[i];
    const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
    return {
      weekNumber: i + 1,
      setsDelta: int(given?.setsDelta),
      repsDelta: int(given?.repsDelta),
      rpeDelta: int(given?.rpeDelta),
      note: typeof given?.note === 'string' ? given.note : undefined,
    };
  });

  return steps.map((step) => ({
    weekNumber: step.weekNumber,
    days: templateDays.map((day) => ({
      dayOfWeek: day?.dayOfWeek,
      workoutType: day?.workoutType,
      focus: day?.focus,
      exercises: (Array.isArray(day?.exercises) ? day.exercises : []).map((ex: any) => ({
        ...ex,
        sets: Math.max(1, int0(ex?.sets) + step.setsDelta),
        reps: shiftReps(ex?.reps, step.repsDelta),
        ...(clampRpe(ex?.rpe, step.rpeDelta) !== undefined
          ? { rpe: clampRpe(ex?.rpe, step.rpeDelta) }
          : {}),
      })),
    })),
  }));

  function int0(v: unknown): number {
    return Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 3;
  }
}

