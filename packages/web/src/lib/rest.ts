/**
 * Shared shapes for the rest countdown.
 *
 * In their own module rather than beside the modal: the provider that owns the
 * countdown and the modal that draws it both need them, and importing them
 * from the modal made that pair circular.
 */

const STORAGE_KEY = 'fittrackr_rest_seconds';

export const REST_PRESETS = [60, 90, 120, 180];
export const REST_MIN_SECONDS = 5;

/** What the athlete just finished. Labels the iOS Live Activity. */
export interface RestContext {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
}

/** A running rest, in the shape the Live Activity and the watch want. */
export interface RestActivity extends RestContext {
  endsAt: number;
  startedAt: number;
}

/**
 * The global fallback duration, kept in localStorage.
 *
 * Still here now that rest is remembered per exercise: a brand-new exercise
 * has no preference of its own, and starting it at the duration the athlete
 * generally uses beats starting it at a hardcoded 90.
 */
export function getStoredRestSeconds(fallback = 90): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return Number.isNaN(v) ? fallback : v;
  } catch {
    return fallback;
  }
}

export function setStoredRestSeconds(seconds: number) {
  try { localStorage.setItem(STORAGE_KEY, String(seconds)); } catch { /* ignore */ }
}
