/**
 * Pure rules behind the Awards tab: which lift a logged exercise counts as,
 * the benchmark tiers, and streak history. No database access, so the whole
 * thing is unit-testable.
 */

export const LB_PER_KG = 2.20462;
export const kgToLb = (kg: number) => kg * LB_PER_KG;

export type LiftKey = 'BENCH' | 'SQUAT' | 'DEADLIFT' | 'OHP';

interface LiftMatcher {
  key: LiftKey;
  label: string;
  /** All must appear in the lowercased name. */
  include: string[];
  /** Any of these disqualifies it. */
  exclude: string[];
}

/**
 * Benchmarks refer to the classic barbell lifts, so variations are excluded
 * deliberately — an incline or dumbbell press is not a 225 bench, and counting
 * it would hand out awards that aren't real.
 */
const MATCHERS: LiftMatcher[] = [
  {
    key: 'BENCH', label: 'Bench Press',
    include: ['bench'],
    exclude: ['incline', 'decline', 'dumbbell', 'machine', 'smith', 'close grip', 'close-grip', 'floor'],
  },
  {
    key: 'SQUAT', label: 'Squat',
    include: ['squat'],
    exclude: ['front', 'goblet', 'split', 'bulgarian', 'hack', 'sissy', 'overhead', 'box', 'zercher', 'smith', 'machine'],
  },
  {
    key: 'DEADLIFT', label: 'Deadlift',
    include: ['deadlift'],
    exclude: ['romanian', 'rdl', 'stiff', 'single', 'sumo stance', 'trap bar', 'trap-bar', 'deficit'],
  },
  {
    key: 'OHP', label: 'Overhead Press',
    include: ['press'],
    exclude: ['bench', 'incline', 'decline', 'leg', 'chest', 'dumbbell', 'machine', 'smith', 'floor'],
  },
];

/** Which benchmark lift this exercise name counts as, if any. */
export function classifyLift(name: string): LiftKey | null {
  const n = (name ?? '').toLowerCase();
  if (!n.trim()) return null;

  for (const m of MATCHERS) {
    if (!m.include.every((w) => n.includes(w))) continue;
    if (m.exclude.some((w) => n.includes(w))) continue;
    // "Overhead Press" needs an extra guard: bare "press" is too broad.
    if (m.key === 'OHP' && !(n.includes('overhead') || n.includes('military') || n.includes('shoulder'))) {
      continue;
    }
    return m.key;
  }
  return null;
}

/** Drives which metal the medal is struck in. */
export type MedalTier = 'STEEL' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface AbsoluteTier {
  id: string;
  lift: LiftKey;
  label: string;
  emoji: string;
  tier: MedalTier;
  /** Struck on the medal face. */
  short: string;
  /** Threshold in POUNDS — these milestones are plate-math, which is imperial. */
  lb: number;
}

export const ABSOLUTE_TIERS: AbsoluteTier[] = [
  { id: 'bench-135', lift: 'BENCH', label: 'One Plate Bench',   emoji: '🔩', tier: 'STEEL',  short: '135', lb: 135 },
  { id: 'bench-225', lift: 'BENCH', label: 'Two Plate Bench',   emoji: '🥉', tier: 'BRONZE', short: '225', lb: 225 },
  { id: 'bench-315', lift: 'BENCH', label: 'Three Plate Bench', emoji: '🥈', tier: 'SILVER', short: '315', lb: 315 },
  { id: 'bench-405', lift: 'BENCH', label: 'Four Plate Bench',  emoji: '🥇', tier: 'GOLD',   short: '405', lb: 405 },

  { id: 'squat-225', lift: 'SQUAT', label: 'Two Plate Squat',   emoji: '🔩', tier: 'STEEL',  short: '225', lb: 225 },
  { id: 'squat-315', lift: 'SQUAT', label: 'Three Plate Squat', emoji: '🥉', tier: 'BRONZE', short: '315', lb: 315 },
  { id: 'squat-405', lift: 'SQUAT', label: 'Four Plate Squat',  emoji: '🥈', tier: 'SILVER', short: '405', lb: 405 },
  { id: 'squat-495', lift: 'SQUAT', label: 'Five Plate Squat',  emoji: '🥇', tier: 'GOLD',   short: '495', lb: 495 },

  { id: 'dead-225', lift: 'DEADLIFT', label: 'Two Plate Deadlift',   emoji: '🔩', tier: 'STEEL',  short: '225', lb: 225 },
  { id: 'dead-315', lift: 'DEADLIFT', label: 'Three Plate Deadlift', emoji: '🥉', tier: 'BRONZE', short: '315', lb: 315 },
  { id: 'dead-405', lift: 'DEADLIFT', label: 'Four Plate Deadlift',  emoji: '🥈', tier: 'SILVER', short: '405', lb: 405 },
  { id: 'dead-495', lift: 'DEADLIFT', label: 'Five Plate Deadlift',  emoji: '🥇', tier: 'GOLD',   short: '495', lb: 495 },

  { id: 'ohp-95',  lift: 'OHP', label: 'One Plate Press',   emoji: '🔩', tier: 'STEEL',  short: '95',  lb: 95 },
  { id: 'ohp-135', lift: 'OHP', label: 'Two Plate Press',   emoji: '🥉', tier: 'BRONZE', short: '135', lb: 135 },
  { id: 'ohp-185', lift: 'OHP', label: 'Three Plate Press', emoji: '🥈', tier: 'SILVER', short: '185', lb: 185 },
];

export interface RelativeTier {
  id: string;
  lift: LiftKey;
  label: string;
  emoji: string;
  tier: MedalTier;
  short: string;
  /** Multiple of bodyweight. */
  ratio: number;
}

export const RELATIVE_TIERS: RelativeTier[] = [
  { id: 'rel-bench-1',   lift: 'BENCH',    label: 'Bodyweight Bench',         emoji: '💪', tier: 'BRONZE',   short: '1×',    ratio: 1 },
  { id: 'rel-bench-1.5', lift: 'BENCH',    label: '1.5× Bodyweight Bench',    emoji: '🔥', tier: 'SILVER',   short: '1.5×',  ratio: 1.5 },
  { id: 'rel-squat-1.5', lift: 'SQUAT',    label: '1.5× Bodyweight Squat',    emoji: '💪', tier: 'BRONZE',   short: '1.5×',  ratio: 1.5 },
  { id: 'rel-squat-2',   lift: 'SQUAT',    label: '2× Bodyweight Squat',      emoji: '🔥', tier: 'GOLD',     short: '2×',    ratio: 2 },
  { id: 'rel-dead-2',    lift: 'DEADLIFT', label: '2× Bodyweight Deadlift',   emoji: '💪', tier: 'SILVER',   short: '2×',    ratio: 2 },
  { id: 'rel-dead-2.5',  lift: 'DEADLIFT', label: '2.5× Bodyweight Deadlift', emoji: '🔥', tier: 'PLATINUM', short: '2.5×',  ratio: 2.5 },
  { id: 'rel-ohp-0.75',  lift: 'OHP',      label: '0.75× Bodyweight Press',   emoji: '💪', tier: 'BRONZE',   short: '0.75×', ratio: 0.75 },
  { id: 'rel-ohp-1',     lift: 'OHP',      label: 'Bodyweight Press',         emoji: '🔥', tier: 'GOLD',     short: '1×',    ratio: 1 },
];

export interface AwardResult {
  id: string;
  label: string;
  emoji: string;
  tier: MedalTier;
  short: string;
  lift: LiftKey;
  family: 'ABSOLUTE' | 'RELATIVE';
  earned: boolean;
  /** Best lifted for this lift, in kg. Null when the lift has never been logged. */
  bestKg: number | null;
  /** What is needed, in kg. Null for relative tiers with no bodyweight on file. */
  targetKg: number | null;
  /** 0..1, or null when it can't be computed. */
  progress: number | null;
}

/**
 * @param bestByLift best MAX_WEIGHT per benchmark lift, in kg
 * @param bodyweightKg latest known bodyweight, or null
 */
export function evaluateAwards(
  bestByLift: Partial<Record<LiftKey, number>>,
  bodyweightKg: number | null,
): AwardResult[] {
  const out: AwardResult[] = [];

  for (const t of ABSOLUTE_TIERS) {
    const bestKg = bestByLift[t.lift] ?? null;
    const targetKg = t.lb / LB_PER_KG;
    out.push({
      id: t.id, label: t.label, emoji: t.emoji, tier: t.tier, short: t.short, lift: t.lift, family: 'ABSOLUTE',
      // Compare in pounds: the thresholds are plate math, and a kg round-trip
      // can leave a genuine 225 lb lift a hair short.
      earned: bestKg != null && Math.round(kgToLb(bestKg) * 10) / 10 >= t.lb,
      bestKg,
      targetKg,
      progress: bestKg == null ? 0 : Math.min(1, kgToLb(bestKg) / t.lb),
    });
  }

  for (const t of RELATIVE_TIERS) {
    const bestKg = bestByLift[t.lift] ?? null;
    const targetKg = bodyweightKg != null ? bodyweightKg * t.ratio : null;
    out.push({
      id: t.id, label: t.label, emoji: t.emoji, tier: t.tier, short: t.short, lift: t.lift, family: 'RELATIVE',
      earned: bestKg != null && targetKg != null && bestKg >= targetKg,
      bestKg,
      targetKg,
      // Without a bodyweight there is no denominator — report null rather than
      // pretending the athlete has made no progress.
      progress: targetKg == null || bestKg == null
        ? (targetKg == null ? null : 0)
        : Math.min(1, bestKg / targetKg),
    });
  }

  return out;
}

// ─── Streak history ───────────────────────────────────────────────────────────

/** Monday-start week key for a YYYY-MM-DD date. Mirrors the web helper. */
export function weekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const mondayOffset = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - mondayOffset);
  return dt.toISOString().slice(0, 10);
}

function addWeeks(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n * 7);
  return dt.toISOString().slice(0, 10);
}

export interface StreakHistory {
  goal: number;
  /** Longest run of consecutive weeks that met the goal, ever. */
  best: number;
  bestStart: string | null;
  bestEnd: string | null;
  /** Weeks in the run ending now (the in-progress week counts only if met). */
  current: number;
  /** Total weeks that met the goal, whether consecutive or not. */
  totalWeeksAtGoal: number;
}

export function streakHistory(
  workoutDates: Iterable<string>,
  today: string,
  goal: number,
): StreakHistory {
  const target = Math.min(Math.max(Math.round(goal) || 1, 1), 7);

  const perWeek = new Map<string, Set<string>>();
  for (const d of workoutDates) {
    const k = weekKey(d);
    if (!perWeek.has(k)) perWeek.set(k, new Set());
    perWeek.get(k)!.add(d);
  }
  const met = (k: string) => (perWeek.get(k)?.size ?? 0) >= target;

  const weeks = [...perWeek.keys()].sort();
  const totalWeeksAtGoal = weeks.filter(met).length;

  // Longest consecutive run: walk from the earliest week to this week so gaps
  // with no logged workouts at all still break the chain.
  let best = 0, run = 0;
  let bestEnd: string | null = null;
  const currentWeek = weekKey(today);
  if (weeks.length > 0) {
    for (let k = weeks[0]; k <= currentWeek; k = addWeeks(k, 1)) {
      if (met(k)) {
        run++;
        if (run > best) { best = run; bestEnd = k; }
      } else {
        run = 0;
      }
    }
  }
  const bestStart = bestEnd && best > 0 ? addWeeks(bestEnd, -(best - 1)) : null;

  // Current run, ending at the last COMPLETE week unless this week already met
  // the goal — an in-progress week isn't a failure yet.
  let current = 0;
  let cursor = currentWeek;
  if (!met(currentWeek)) cursor = addWeeks(currentWeek, -1);
  while (met(cursor)) {
    current++;
    cursor = addWeeks(cursor, -1);
  }

  return { goal: target, best, bestStart, bestEnd, current, totalWeeksAtGoal };
}
