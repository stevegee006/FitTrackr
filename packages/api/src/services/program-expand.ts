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

/** Loads may be cut hard for a deload, but never doubled by a stray decimal. */
export const MIN_LOAD_MULTIPLIER = 0.5;
export const MAX_LOAD_MULTIPLIER = 1.5;

export function clampLoadMultiplier(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const clamped = Math.min(MAX_LOAD_MULTIPLIER, Math.max(MIN_LOAD_MULTIPLIER, n));
  // 1 is the default; storing it would imply a decision that was not made.
  return clamped === 1 ? undefined : Math.round(clamped * 1000) / 1000;
}

/** Match an override to a template exercise by name, forgiving case and spacing. */
export function normaliseName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Expand a one-week template + progression into the week-by-week `ProgramData`
 * shape the frontend already reads. Tolerant by design: a missing or short
 * progression is padded so generation never fails on model sloppiness.
 *
 * **Why a template plus a progression, and not every week longhand.** A
 * measured 8000-token response took 79 s, so writing every week out costs
 * roughly 2k tokens per week — about 160 s for eight weeks and well past the
 * 180 s reverse-proxy ceiling for twelve. The template stays flat in cost
 * however long the program is.
 *
 * **Why the progression grew beyond three integers.** It used to carry only
 * `setsDelta`, `repsDelta` and `rpeDelta`, applied uniformly to every
 * exercise — so every week was week one with a set bolted on, while the model
 * wrote genuinely different intentions in prose that nothing read. "Add a set
 * to the compounds only" and "drop the bar 10-15% for the deload" are now
 * expressible as data: `exercises` carries sparse per-exercise overrides, and
 * `loadMultiplier` scales the working weight.
 *
 * Sparse is what keeps it cheap. A deload week names a multiplier and nothing
 * else; a ramp week names two or three lifts. The response does not grow with
 * the program's length.
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
    // Sparse per-exercise overrides, keyed by normalised name. A name the
    // template does not contain is dropped rather than added: the progression
    // adjusts the week, it does not invent exercises for it.
    const overrides = new Map<string, any>();
    if (Array.isArray(given?.exercises)) {
      for (const o of given.exercises) {
        const key = normaliseName(o?.name);
        if (key) overrides.set(key, o);
      }
    }

    return {
      weekNumber: i + 1,
      setsDelta: int(given?.setsDelta),
      repsDelta: int(given?.repsDelta),
      rpeDelta: int(given?.rpeDelta),
      isDeload: given?.isDeload === true,
      loadMultiplier: clampLoadMultiplier(given?.loadMultiplier),
      overrides,
      note: typeof given?.note === 'string' ? given.note : undefined,
    };
  });

  return steps.map((step) => ({
    weekNumber: step.weekNumber,
    ...(step.isDeload ? { isDeload: true } : {}),
    ...(step.loadMultiplier !== undefined ? { loadMultiplier: step.loadMultiplier } : {}),
    ...(step.note ? { note: step.note } : {}),
    days: templateDays.map((day) => ({
      dayOfWeek: day?.dayOfWeek,
      workoutType: day?.workoutType,
      focus: day?.focus,
      exercises: (Array.isArray(day?.exercises) ? day.exercises : []).map((ex: any) => {
        // Uniform deltas first, then this week's override for this exercise.
        // An override is an ABSOLUTE value — "5 sets", not "+1" — because that
        // is how the model states it in prose and leaves no room to wonder
        // whether the delta was already counted.
        const o = step.overrides.get(normaliseName(ex?.name));

        const sets = o?.sets !== undefined && Number.isFinite(Number(o.sets))
          ? Math.max(1, Math.trunc(Number(o.sets)))
          : Math.max(1, int0(ex?.sets) + step.setsDelta);

        const reps = typeof o?.reps === 'string' && o.reps.trim()
          ? o.reps.trim()
          : shiftReps(ex?.reps, step.repsDelta);

        // An overridden RPE is still clamped: the ceiling exists to stop a
        // program ending at RPE 10 everywhere, whichever route set it.
        const rpe = o?.rpe !== undefined
          ? clampRpe(o.rpe, 0)
          : clampRpe(ex?.rpe, step.rpeDelta);

        return {
          ...ex,
          sets,
          reps,
          ...(rpe !== undefined ? { rpe } : {}),
          // The week's own coaching note wins — it is the more specific of the
          // two and is what the athlete needs for THIS session.
          ...(typeof o?.notes === 'string' && o.notes.trim()
            ? { notes: o.notes.trim() }
            : {}),
        };
      }),
    })),
  }));

  function int0(v: unknown): number {
    return Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 3;
  }
}

