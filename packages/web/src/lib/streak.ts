/**
 * Weekly-goal training streak.
 *
 * The old rule was "consecutive days with a workout", which reset the moment
 * you took a rest day — meaningless for anyone training a fixed number of days
 * per week. This counts consecutive WEEKS that met the goal instead, so a
 * 5-day-a-week target survives the two rest days.
 */

/** Monday-start week key (YYYY-MM-DD of that Monday) for a YYYY-MM-DD date. */
export function weekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Local-noon avoids any DST edge shifting the date backwards.
  const dt = new Date(y, m - 1, d, 12);
  const mondayOffset = (dt.getDay() + 6) % 7;
  const monday = new Date(y, m - 1, d - mondayOffset, 12);
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

/** The Monday `n` weeks before the given week key. */
export function weeksBefore(weekKey: string, n: number): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d - n * 7, 12);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export interface StreakResult {
  /** Consecutive weeks meeting the goal. */
  weeks: number;
  /** Distinct training days in the current (in-progress) week. */
  thisWeekDays: number;
  /** The goal used. */
  goal: number;
  /** True when the current week already meets the goal. */
  goalMetThisWeek: boolean;
}

/**
 * @param workoutDates distinct YYYY-MM-DD dates with a logged workout
 * @param today        YYYY-MM-DD
 * @param goal         target training days per week (1-7)
 * @param maxWeeks     how far back to look
 */
export function weeklyStreak(
  workoutDates: Iterable<string>,
  today: string,
  goal: number,
  maxWeeks = 26,
): StreakResult {
  const target = Math.min(Math.max(Math.round(goal) || 1, 1), 7);

  // distinct training days per week
  const daysPerWeek = new Map<string, Set<string>>();
  for (const d of workoutDates) {
    const wk = weekStart(d);
    if (!daysPerWeek.has(wk)) daysPerWeek.set(wk, new Set());
    daysPerWeek.get(wk)!.add(d);
  }
  const countIn = (wk: string) => daysPerWeek.get(wk)?.size ?? 0;

  const currentWeek = weekStart(today);
  const thisWeekDays = countIn(currentWeek);
  const goalMetThisWeek = thisWeekDays >= target;

  // The current week is still in progress, so falling short of the goal today
  // is not a failure yet — it simply doesn't add to the streak. Counting
  // therefore starts at last week unless this week is already complete.
  let weeks = 0;
  let start = 1;
  if (goalMetThisWeek) {
    weeks = 1;
    start = 1;
  }
  for (let i = start; i <= maxWeeks; i++) {
    if (countIn(weeksBefore(currentWeek, i)) >= target) weeks++;
    else break;
  }

  return { weeks, thisWeekDays, goal: target, goalMetThisWeek };
}

// ─── Consistency badges ───────────────────────────────────────────────────────

export interface StreakBadge {
  /** Weeks required to earn it. */
  weeks: number;
  label: string;
  emoji: string;
  /** Tailwind classes for the chip. */
  className: string;
}

/**
 * Milestones for consecutive weeks at the weekly attendance goal. Deliberately
 * front-loaded: the first badge lands at 2 weeks so there is something to earn
 * early, then the gaps widen so later ones stay meaningful.
 */
export const STREAK_BADGES: StreakBadge[] = [
  { weeks: 2,  label: 'Consistent',  emoji: '🌱', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50' },
  { weeks: 4,  label: 'One Month',   emoji: '⭐', className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/50' },
  { weeks: 8,  label: 'Two Months',  emoji: '🔥', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/50' },
  { weeks: 12, label: 'One Quarter', emoji: '💎', className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/50' },
  { weeks: 26, label: 'Half Year',   emoji: '🏆', className: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50' },
  { weeks: 52, label: 'Full Year',   emoji: '👑', className: 'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-700/50' },
];

/** Highest badge earned at this streak length, or null below the first. */
export function earnedBadge(weeks: number): StreakBadge | null {
  let best: StreakBadge | null = null;
  for (const b of STREAK_BADGES) {
    if (weeks >= b.weeks) best = b;
  }
  return best;
}

/** The next badge to aim for, or null once every one is earned. */
export function nextBadge(weeks: number): StreakBadge | null {
  return STREAK_BADGES.find((b) => weeks < b.weeks) ?? null;
}
