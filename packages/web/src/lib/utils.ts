import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Format a Date to YYYY-MM-DD in local timezone (not UTC) */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateLocal(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's date as YYYY-MM-DD in local timezone */
export function todayString(): string {
  return formatDate(new Date());
}

/** Parse a YYYY-MM-DD string as a local date (avoids UTC interpretation) */
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add/subtract days from a YYYY-MM-DD string, returns YYYY-MM-DD */
export function addDays(dateStr: string, offset: number): string {
  const d = parseDateLocal(dateStr);
  d.setDate(d.getDate() + offset);
  return formatDate(d);
}

/**
 * Evaluate a simple math expression string (e.g. "150-32", "100+50", "2*30").
 * Only supports +, -, *, / with numbers. Returns null if invalid.
 */
export function evalMathExpr(expr: string): number | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  // Only allow digits, decimal points, spaces, and +-*/
  if (!/^[\d\s.+\-*/()]+$/.test(trimmed)) return null;
  try {
    // Use Function constructor to safely evaluate (no access to scope)
    const result = new Function(`"use strict"; return (${trimmed})`)() as number;
    if (typeof result !== 'number' || !isFinite(result) || result < 0) return null;
    return Math.round(result * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Format a duration in minutes as hours and minutes: 45 → "45m",
 * 60 → "1h", 75 → "1h 15m". Durations are stored as total minutes; this is
 * display only. Non-finite or negative input returns null so callers can
 * render nothing rather than "NaNm".
 */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Split total minutes into { hours, minutes } for a two-field editor. */
export function splitDuration(minutes: number | null | undefined): { hours: number; minutes: number } {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return { hours: 0, minutes: 0 };
  const total = Math.round(minutes);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
