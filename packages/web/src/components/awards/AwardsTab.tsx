'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Medal, type MedalTier } from '@/components/awards/Medal';
import { todayString } from '@/lib/utils';
import { Flame, Info } from 'lucide-react';

const LB_PER_KG = 2.20462;

interface Award {
  id: string;
  label: string;
  tier: MedalTier;
  short: string;
  lift: 'BENCH' | 'SQUAT' | 'DEADLIFT' | 'OHP';
  family: 'ABSOLUTE' | 'RELATIVE';
  earned: boolean;
  bestKg: number | null;
  targetKg: number | null;
  progress: number | null;
}

interface AwardsData {
  awards: Award[];
  bodyweightKg: number | null;
  liftSources: Partial<Record<string, { name: string; bestKg: number }>>;
  streaks: {
    goal: number;
    best: number;
    bestStart: string | null;
    bestEnd: string | null;
    current: number;
    totalWeeksAtGoal: number;
  };
}

const LIFT_LABEL: Record<string, string> = {
  BENCH: 'Bench Press',
  SQUAT: 'Squat',
  DEADLIFT: 'Deadlift',
  OHP: 'Overhead Press',
};
const LIFT_ORDER = ['BENCH', 'SQUAT', 'DEADLIFT', 'OHP'];

export function AwardsTab({ isImperial }: { isImperial: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['awards'],
    // The client's local date keeps week boundaries matching the dashboard.
    queryFn: () => apiFetch<{ data: AwardsData }>(`/awards?today=${todayString()}`),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error || !data) {
    return (
      <Card className="py-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {(error as any)?.message ?? 'Could not load awards.'}
        </p>
      </Card>
    );
  }

  const { awards, streaks, bodyweightKg } = data.data;
  const unit = isImperial ? 'lbs' : 'kg';
  const w = (kg: number) => Math.round((isImperial ? kg * LB_PER_KG : kg) * 10) / 10;

  const earnedCount = awards.filter((a) => a.earned).length;
  const absolute = awards.filter((a) => a.family === 'ABSOLUTE');
  const relative = awards.filter((a) => a.family === 'RELATIVE');

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Headline */}
      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {earnedCount}
            <span className="text-base font-medium text-gray-400 dark:text-gray-500"> / {awards.length}</span>
          </p>
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Medals earned</p>
        </div>
        <div className="flex -space-x-2">
          {awards.filter((a) => a.earned).slice(-4).map((a) => (
            <Medal key={a.id} tier={a.tier} label={a.short} size={40} title={a.label} />
          ))}
        </div>
      </Card>

      {/* Streak history */}
      <Card className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Flame className="h-4 w-4 text-orange-500" />
          Consistency
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Best streak', value: `${streaks.best}w` },
            { label: 'Current', value: `${streaks.current}w` },
            { label: 'Weeks at goal', value: String(streaks.totalWeeksAtGoal) },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{t.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {streaks.best > 0 && streaks.bestStart && streaks.bestEnd ? (
            <>Best run: {fmtDate(streaks.bestStart)} → {fmtDate(streaks.bestEnd)} at {streaks.goal}×/week.</>
          ) : (
            <>No full week at your {streaks.goal}×/week goal yet.</>
          )}
        </p>
      </Card>

      <AwardSection
        title="Plate Club"
        subtitle="Classic barbell milestones. Variations don't count — an incline or dumbbell press isn't a bench."
        awards={absolute}
        unit={unit}
        w={w}
        isImperial={isImperial}
      />

      <AwardSection
        title="Relative Strength"
        subtitle={
          bodyweightKg == null
            ? 'Log a bodyweight in Measurements to unlock these.'
            : `Scaled to your bodyweight (${w(bodyweightKg)} ${unit}).`
        }
        awards={relative}
        unit={unit}
        w={w}
        isImperial={isImperial}
      />

      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 pb-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        Medals come from your heaviest logged working set. If one looks wrong, use
        Recalculate on the PRs tab.
      </p>
    </div>
  );
}

function AwardSection({
  title, subtitle, awards, unit, w, isImperial,
}: {
  title: string;
  subtitle: string;
  awards: Award[];
  unit: string;
  w: (kg: number) => number;
  isImperial: boolean;
}) {
  const byLift = LIFT_ORDER
    .map((lift) => ({ lift, items: awards.filter((a) => a.lift === lift) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">{subtitle}</p>
      </div>

      {byLift.map(({ lift, items }) => (
        <Card key={lift} className="space-y-2">
          <p className="text-sm font-semibold">{LIFT_LABEL[lift]}</p>
          <div className="grid grid-cols-4 gap-2">
            {items.map((a) => {
              // Progress is null when it can't be known (no bodyweight logged),
              // which is different from "no progress".
              const pct = a.progress == null ? null : Math.round(a.progress * 100);
              return (
                <div key={a.id} className="flex flex-col items-center text-center">
                  <Medal tier={a.tier} label={a.short} earned={a.earned} size={56} title={a.label} />
                  <p className="mt-1 text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                    {a.earned ? 'Earned' : a.targetKg != null ? `${w(a.targetKg)} ${unit}` : '—'}
                  </p>
                  {!a.earned && pct != null && (
                    <>
                      <div className="mt-1 h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-0.5 text-[9px] text-gray-400 dark:text-gray-500">
                        {a.bestKg != null ? `${w(a.bestKg)}` : '0'} / {a.targetKg != null ? w(a.targetKg) : '?'}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
