'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import {
  MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS, WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS,
} from '@fittrackr/shared';
import { weekStart, weeksBefore } from '@/lib/streak';
import { CoachReviewCard, type CoachReview } from '@/components/coach/CoachReviewCard';
import { todayString, parseDateLocal, formatDuration } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, BarChart3, Trophy, Sparkles, Target, Check,
  TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Calendar, CalendarPlus,
} from 'lucide-react';

const LB_PER_KG = 2.20462;

interface RecapSession {
  id: string;
  name: string | null;
  workoutType: string;
  logDate: string;
  durationMin: number | null;
  isFinished: boolean;
  sets: number;
}

interface WeeklyRecap {
  weekStart: string;
  weekEnd: string;
  sessions: RecapSession[];
  totals: {
    sessions: number; sets: number; totalReps: number; volumeKg: number;
    durationSec: number; distanceM: number; trainingMin: number; skippedSets: number;
  };
  previous: { sessions: number; sets: number; volumeKg: number; trainingMin: number };
  setsByMuscle: Record<string, number>;
  weeklyTargets: Record<string, number> | null;
  exercises: Array<{
    exerciseId: string; name: string; sessions: number; sets: number;
    firstTopKg: number | null; lastTopKg: number | null;
    durationSec: number; distanceM: number;
  }>;
  personalRecords: Array<{
    exerciseId: string; exerciseName: string; recordType: string; value: number;
  }>;
  goal: { weeklyFrequency: number | null; trainingDays: number; met: boolean | null };
}

interface NextWeekPlan {
  weekStart: string;
  model: string;
  plan: {
    focus: string;
    days: Array<{
      label: string; workoutType: string; focus: string;
      exercises: Array<{ name: string; sets: number; reps: string; load: number | null; why: string }>;
    }>;
    adjustments: string[];
    cautions: string[];
  };
}

const RECORD_LABELS: Record<string, string> = {
  MAX_WEIGHT: 'Heaviest', MAX_REPS: 'Most reps', MAX_1RM: 'Est. 1RM', MAX_VOLUME: 'Best volume',
};

export default function WeeklyRecapPage() {
  const queryClient = useQueryClient();
  const today = todayString();
  const thisWeek = weekStart(today);
  const [week, setWeek] = useState(thisWeek);
  // Both AI features cost a call, so neither is fetched on load — each waits
  // for its own button. Keyed by week so navigating weeks resets them.
  const [planWeek, setPlanWeek] = useState<string | null>(null);
  const [reviewWeek, setReviewWeek] = useState<string | null>(null);

  /**
   * What the NEXT fetch of each AI card should do. Held in refs, not in the
   * query key, so `refetch()` reads the intent at call time and a later remount
   * cannot silently replay a "refresh" and re-spend a credit. Reset to 'peek'
   * as soon as the request is issued.
   */
  const reviewMode = useRef<'peek' | 'generate' | 'refresh'>('peek');
  const planMode = useRef<'peek' | 'generate' | 'refresh'>('peek');

  function modeParam(ref: { current: 'peek' | 'generate' | 'refresh' }) {
    const mode = ref.current;
    ref.current = 'peek';
    return mode === 'generate' ? '&generate=1' : mode === 'refresh' ? '&refresh=1' : '';
  }

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });
  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const unit = isImperial ? 'lbs' : 'kg';
  const vol = (kg: number) => Math.round(isImperial ? kg * LB_PER_KG : kg).toLocaleString();
  const wt = (kg: number) => Math.round((isImperial ? kg * LB_PER_KG : kg) * 10) / 10;

  const { data, isLoading } = useQuery({
    queryKey: ['weekly-recap', week],
    queryFn: () => apiFetch<{ data: WeeklyRecap }>(`/workouts/weekly-recap?weekStart=${week}`),
  });

  // Always queried, never auto-generated. A bare GET returns whatever is
  // stored server-side and costs nothing, so a review generated days ago shows
  // up on load instead of hiding behind a button that was already pressed
  // once. Only `generate` (the button) and `refresh` spend a credit.
  const reviewQuery = useQuery({
    queryKey: ['week-review', week],
    queryFn: () =>
      apiFetch<{ data: { model: string; review: CoachReview } | null; cached: boolean }>(
        `/coach/week-review?weekStart=${week}${modeParam(reviewMode)}`,
        { timeout: 120_000 },
      ),
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });

  const applyPlanMutation = useMutation({
    mutationFn: (plan: NextWeekPlan) =>
      apiFetch<{ data: { created: Array<{ id: string; logDate: string; name: string; sets: number }>; skipped: string[] } }>(
        '/coach/next-week-plan/apply',
        {
          method: 'POST',
          body: JSON.stringify({
            weekStart: plan.weekStart,
            // Only the fields the server writes — `why` is commentary.
            days: plan.plan.days.map((d) => ({
              label: d.label,
              workoutType: d.workoutType,
              focus: d.focus,
              exercises: d.exercises.map((e) => ({
                name: e.name, sets: e.sets, reps: e.reps, load: e.load,
              })),
            })),
          }),
        },
      ),
    onSuccess: () => {
      // Next week's workouts now exist, so anything listing workouts is stale.
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['weekly-recap'] });
    },
  });

  // The review's conclusion is forwarded to the planner when one exists, so
  // the two stop being independent opinions — the review recommended a second
  // leg day while the plan kept the old split, off the same numbers.
  const reviewFocus = reviewQuery.data?.data?.review.focusNextWeek ?? null;

  const planQuery = useQuery({
    queryKey: ['next-week-plan', week],
    queryFn: () =>
      apiFetch<{ data: NextWeekPlan | null; cached: boolean }>(
        `/coach/next-week-plan?weekStart=${week}${modeParam(planMode)}${
          reviewFocus ? `&focus=${encodeURIComponent(reviewFocus)}` : ''
        }`,
        { timeout: 120_000 },
      ),
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });

  const s = data?.data;
  const isCurrentWeek = week === thisWeek;
  // A plan or review belongs to the week it was generated for; showing last
  // week's advice under this week's numbers would be quietly wrong.
  const planForThisWeek = planQuery.data?.data ?? null;
  const reviewForThisWeek = reviewQuery.data?.data ?? null;
  const rangeLabel = s
    ? `${parseDateLocal(s.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseDateLocal(s.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  /**
   * How an exercise's week is described in one cell.
   *
   * Time and distance come FIRST: a treadmill walk carries no load, and
   * falling through to a weight check labelled it "bodyweight" — the same
   * mistake as treating a missing weight as missing data (#74). "bodyweight"
   * is only correct when there is genuinely no load, no clock and no distance.
   */
  function exerciseWork(e: WeeklyRecap['exercises'][number]): string {
    const parts: string[] = [];
    if (e.durationSec > 0) parts.push(`${Math.round(e.durationSec / 60)} min`);
    if (e.distanceM > 0) {
      parts.push(isImperial
        ? `${(e.distanceM / 1609.344).toFixed(2)} mi`
        : `${(e.distanceM / 1000).toFixed(2)} km`);
    }
    if (parts.length > 0) return parts.join(' · ');

    if (e.firstTopKg != null && e.lastTopKg != null) {
      return e.firstTopKg === e.lastTopKg
        ? `${wt(e.lastTopKg)} ${unit}`
        : `${wt(e.firstTopKg)} → ${wt(e.lastTopKg)} ${unit}`;
    }
    return 'bodyweight';
  }

  function delta(current: number, previous: number) {
    if (previous === 0) return null;
    return current - previous;
  }

  function DeltaChip({ value, suffix }: { value: number | null; suffix?: string }) {
    if (value == null) return null;
    if (value === 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
          <Minus className="h-3 w-3" />same
        </span>
      );
    }
    const up = value > 0;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {up ? '+' : ''}{value.toLocaleString()}{suffix ?? ''}
      </span>
    );
  }

  const header = (
    <div className="flex items-center gap-3">
      <Link href="/dashboard"
        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold truncate">Weekly Recap</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {rangeLabel}{isCurrentWeek ? ' · in progress' : ''}
        </p>
      </div>
      <button type="button" onClick={() => setWeek((w) => weeksBefore(w, 1))}
        className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Previous week" aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </button>
      {/* Never forward past the current week — a recap of a week that has not
          happened is an empty page, not information. */}
      <button type="button" onClick={() => setWeek((w) => weeksBefore(w, -1))}
        disabled={isCurrentWeek}
        className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
        title="Next week" aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex justify-center py-16"><Spinner /></div>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="space-y-4">
        {header}
        <Card className="py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Could not load this week.</p>
        </Card>
      </div>
    );
  }

  const muscleRows = Object.entries(s.setsByMuscle).sort((a, b) => b[1] - a[1]);
  // A target with zero work is the useful part — it cannot come from
  // setsByMuscle, which only has muscles that were trained.
  const missedTargets = Object.entries(s.weeklyTargets ?? {})
    .filter(([m, target]) => (target ?? 0) > 0 && !(s.setsByMuscle[m] > 0));

  return (
    <div className="space-y-4">
      {header}

      {s.totals.sessions === 0 ? (
        <Card className="py-10 text-center space-y-1">
          <Calendar className="h-6 w-6 mx-auto text-gray-300 dark:text-gray-600" />
          <p className="font-semibold text-gray-700 dark:text-gray-200">Nothing logged this week</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isCurrentWeek ? 'Log a workout and it will show up here.' : 'No sessions in this week.'}
          </p>
        </Card>
      ) : (
        <>
          {/* Totals */}
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Sessions', value: String(s.totals.sessions), d: delta(s.totals.sessions, s.previous.sessions) },
                { label: 'Sets', value: String(s.totals.sets), d: delta(s.totals.sets, s.previous.sets) },
                { label: 'Reps', value: s.totals.totalReps.toLocaleString(), d: null },
                { label: `Volume (${unit})`, value: vol(s.totals.volumeKg), d: null },
              ].map((t) => (
                <div key={t.label} className="text-center">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{t.label}</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.value}</p>
                  <DeltaChip value={t.d} />
                </div>
              ))}
            </div>

            {(s.totals.trainingMin > 0 || s.totals.durationSec > 0 || s.totals.distanceM > 0) && (
              <p className="mt-3 text-center text-[11px] text-gray-500 dark:text-gray-400">
                {s.totals.trainingMin > 0 && `${formatDuration(s.totals.trainingMin)} under the bar`}
                {s.totals.trainingMin > 0 && s.totals.durationSec > 0 && ' · '}
                {s.totals.durationSec > 0 && `${Math.round(s.totals.durationSec / 60)} min of timed work`}
                {s.totals.distanceM > 0 && ` · ${(isImperial ? s.totals.distanceM / 1609.344 : s.totals.distanceM / 1000).toFixed(2)} ${isImperial ? 'mi' : 'km'} covered`}
              </p>
            )}

            {/* Same note as the session recap: says why the numbers are lower
                than the logger shows, instead of looking like lost data. */}
            {s.totals.skippedSets > 0 && (
              <p className="mt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
                {s.totals.skippedSets} {s.totals.skippedSets === 1 ? 'set was' : 'sets were'} left unchecked and{' '}
                {s.totals.skippedSets === 1 ? 'is' : 'are'} not counted
              </p>
            )}
          </Card>

          {/* Training days vs goal */}
          {s.goal.weeklyFrequency != null && (
            <Card className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${s.goal.met ? 'bg-emerald-100 dark:bg-emerald-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
                {s.goal.met
                  ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  : <Target className="h-4 w-4 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {s.goal.trainingDays} of {s.goal.weeklyFrequency} training days
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {s.goal.met
                    ? 'Weekly goal met'
                    : isCurrentWeek
                      ? `${s.goal.weeklyFrequency - s.goal.trainingDays} to go`
                      : 'Weekly goal missed'}
                </p>
              </div>
            </Card>
          )}

          {/* Sets per muscle */}
          <Card>
            <p className="text-sm font-semibold mb-3">Sets by Muscle Group</p>
            <div className="space-y-2">
              {muscleRows.map(([muscle, sets]) => {
                const target = s.weeklyTargets?.[muscle];
                const max = Math.max(...muscleRows.map(([, n]) => n), target ?? 0, 1);
                const color = (MUSCLE_GROUP_COLORS as any)[muscle] ?? '#6b7280';
                return (
                  <div key={muscle} className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs w-24 shrink-0 truncate">
                      {(MUSCLE_GROUP_LABELS as any)[muscle] ?? muscle}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min((sets / max) * 100, 100)}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                      {sets}{target ? `/${target}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            {missedTargets.length > 0 && (
              <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                No work at all for {missedTargets.map(([m]) => (MUSCLE_GROUP_LABELS as any)[m] ?? m).join(', ')}
              </p>
            )}
          </Card>

          {/* Sessions */}
          <Card className="space-y-2">
            <p className="text-sm font-semibold">Sessions</p>
            {s.sessions.map((w) => {
              const color = (WORKOUT_TYPE_COLORS as any)[w.workoutType] ?? '#6b7280';
              return (
                <div key={w.id} className="flex items-center gap-2">
                  <Link href={`/workouts/${w.id}`} className="flex-1 min-w-0 group">
                    <p className="text-sm font-medium truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {w.name ?? (WORKOUT_TYPE_LABELS as any)[w.workoutType] ?? w.workoutType}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {parseDateLocal(w.logDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{w.sets} sets
                      {formatDuration(w.durationMin) ? ` · ${formatDuration(w.durationMin)}` : ''}
                      {w.isFinished ? '' : ' · open'}
                    </p>
                  </Link>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: color + '20', color }}>
                    {(WORKOUT_TYPE_LABELS as any)[w.workoutType] ?? w.workoutType}
                  </span>
                  <Link href={`/workouts/${w.id}/summary`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors shrink-0"
                    title="Session summary" aria-label="Session summary">
                    <BarChart3 className="h-4 w-4" />
                  </Link>
                </div>
              );
            })}
          </Card>

          {/* PRs */}
          {s.personalRecords.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 space-y-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {s.personalRecords.length} personal record{s.personalRecords.length === 1 ? '' : 's'}
                </p>
              </div>
              {s.personalRecords.map((p, i) => (
                <p key={`${p.exerciseId}-${p.recordType}-${i}`} className="text-xs text-amber-800 dark:text-amber-200">
                  <span className="font-medium">{p.exerciseName}</span>
                  {' — '}{RECORD_LABELS[p.recordType] ?? p.recordType}{' '}
                  {p.recordType === 'MAX_REPS' ? `${p.value} reps` : `${wt(p.value)} ${unit}`}
                </p>
              ))}
            </Card>
          )}

          {/* Exercise movement */}
          {s.exercises.length > 0 && (
            <Card className="space-y-1.5">
              <p className="text-sm font-semibold mb-1">Exercises</p>
              {s.exercises.map((e) => (
                <div key={e.exerciseId} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 truncate">{e.name}</span>
                  <span className="text-gray-500 shrink-0">{e.sets} sets</span>
                  <span className="w-32 text-right shrink-0 text-gray-500">
                    {exerciseWork(e)}
                  </span>
                </div>
              ))}
            </Card>
          )}

          {/* Coach's read on the week */}
          <CoachReviewCard
            title="Coach's review of this week"
            blurb={`Reads this week's numbers and gives insights and pointers, using your own AI key.${isCurrentWeek ? ' The week is still in progress.' : ''}`}
            buttonLabel="Review this week"
            loadingLabel="Reading this week…"
            started={reviewWeek === week || reviewForThisWeek != null}
            isLoading={reviewQuery.isFetching && reviewForThisWeek == null}
            isFetching={reviewQuery.isFetching}
            error={reviewQuery.error}
            review={reviewForThisWeek?.review ?? null}
            model={reviewForThisWeek?.model}
            onStart={() => { reviewMode.current = 'generate'; setReviewWeek(week); reviewQuery.refetch(); }}
            onRefresh={() => { reviewMode.current = 'refresh'; reviewQuery.refetch(); }}
          />

          {/* AI plan for next week */}
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <p className="text-sm font-semibold flex-1">Plan for next week</p>
              {planForThisWeek && (
                <button type="button"
                  onClick={() => { planMode.current = 'refresh'; planQuery.refetch(); }}
                  disabled={planQuery.isFetching}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                  title="Regenerate" aria-label="Regenerate plan">
                  <RefreshCw className={`h-3.5 w-3.5 ${planQuery.isFetching ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            {!planForThisWeek && planWeek == null && !planQuery.isFetching && (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Builds a plan from this week&apos;s numbers using your own AI key. One call per week.
                </p>
                <button type="button"
                  onClick={() => { planMode.current = 'generate'; setPlanWeek(week); planQuery.refetch(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-sm font-semibold transition-all">
                  <Sparkles className="h-4 w-4" />
                  Get a plan for next week
                </button>
              </>
            )}

            {planQuery.isFetching && !planForThisWeek && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                <Spinner /> Writing next week&apos;s plan…
              </div>
            )}

            {planQuery.error && (
              <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{(planQuery.error as Error)?.message || 'Could not build a plan.'}</span>
              </div>
            )}

            {planForThisWeek && (
              <div className="space-y-3">
                <p className="text-sm text-gray-800 dark:text-gray-100">{planForThisWeek.plan.focus}</p>

                {planForThisWeek.plan.days.map((d, i) => {
                  const color = (WORKOUT_TYPE_COLORS as any)[d.workoutType] ?? '#6b7280';
                  return (
                    <div key={`${d.label}-${i}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold w-10 shrink-0">{d.label}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: color + '20', color }}>
                          {(WORKOUT_TYPE_LABELS as any)[d.workoutType] ?? d.workoutType}
                        </span>
                        <span className="text-xs text-gray-500 truncate">{d.focus}</span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {d.exercises.map((ex, j) => (
                          <div key={`${ex.name}-${j}`} className="text-xs">
                            <span className="font-medium">{ex.name}</span>
                            {/* The prescription is DERIVED, not a string from
                                the model — the same structured fields are what
                                get written as real sets when applied. */}
                            <span className="text-gray-500">
                              {' '}— {ex.sets}x{ex.reps}
                              {ex.load != null ? ` @ ${ex.load} ${unit}` : ' @ bodyweight'}
                            </span>
                            {ex.why && <p className="text-[11px] text-gray-400 dark:text-gray-500">{ex.why}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {planForThisWeek.plan.adjustments.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Changes from this week</p>
                    {planForThisWeek.plan.adjustments.map((a, i) => (
                      <p key={i} className="text-xs text-gray-700 dark:text-gray-200">• {a}</p>
                    ))}
                  </div>
                )}

                {planForThisWeek.plan.cautions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Watch</p>
                    {planForThisWeek.plan.cautions.map((c, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-300">• {c}</p>
                    ))}
                  </div>
                )}

                {/* Write the plan into real workouts on next week's dates.
                    Only exercises already in the library are used; anything
                    the coach invented is reported rather than created, because
                    WorkoutSet.exerciseId does not cascade and a junk exercise
                    that gets used once can never be deleted. */}
                {applyPlanMutation.data ? (
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-2.5 space-y-1">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                      <Check className="h-3.5 w-3.5" />
                      Added {applyPlanMutation.data.data.created.length} workout
                      {applyPlanMutation.data.data.created.length === 1 ? '' : 's'} to next week
                    </p>
                    {applyPlanMutation.data.data.created.map((w) => (
                      <Link key={w.id} href={`/workouts/${w.id}`}
                        className="block text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline">
                        {parseDateLocal(w.logDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}{w.name} · {w.sets} sets
                      </Link>
                    ))}
                    {applyPlanMutation.data.data.skipped.length > 0 && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        Not in your exercise library, so left out:{' '}
                        {applyPlanMutation.data.data.skipped.join(', ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <button type="button"
                      onClick={() => applyPlanMutation.mutate(planForThisWeek)}
                      disabled={applyPlanMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 text-sm font-semibold transition-all disabled:opacity-40">
                      {applyPlanMutation.isPending
                        ? <><Spinner /> Adding…</>
                        : <><CalendarPlus className="h-4 w-4" /> Add these workouts to next week</>}
                    </button>
                    {applyPlanMutation.error != null && (
                      <p className="text-xs text-red-500">
                        {(applyPlanMutation.error as Error)?.message || 'Could not add the workouts.'}
                      </p>
                    )}
                  </>
                )}

                <p className="text-[10px] text-gray-400 dark:text-gray-500">Generated by {planForThisWeek.model}</p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
