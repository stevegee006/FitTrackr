'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { ChevronLeft, Trophy, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { MUSCLE_GROUP_LABELS } from '@fittrackr/shared';

const LB_PER_KG = 2.20462;

interface ProgramSummary {
  program: { id: string; name: string; durationWeeks: number; isActive: boolean; aiModel: string };
  adherence: {
    plannedSessions: number;
    completedSessions: number;
    percent: number | null;
    weeksTrained: number;
    firstWorkout: string | null;
    lastWorkout: string | null;
  };
  totals: { sets: number; totalReps: number; volumeKg: number; durationMin: number };
  setsByMuscle: Record<string, number>;
  exercises: Array<{
    exerciseId: string;
    name: string;
    sessions: number;
    sets: number;
    volumeKg: number;
    firstTopWeightKg: number | null;
    lastTopWeightKg: number | null;
    changeKg: number | null;
  }>;
  personalRecords: Array<{
    exerciseName: string;
    recordType: string;
    value: number;
    achievedAt: string;
  }>;
}

const PR_LABEL: Record<string, string> = {
  MAX_WEIGHT: 'Heaviest weight',
  MAX_REPS: 'Most reps',
  MAX_1RM: 'Est. 1RM',
};

export default function ProgramSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });
  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const unit = isImperial ? 'lbs' : 'kg';
  const w = (kg: number) => Math.round((isImperial ? kg * LB_PER_KG : kg) * 10) / 10;
  const vol = (kg: number) => Math.round(isImperial ? kg * LB_PER_KG : kg).toLocaleString();

  const { data, isLoading, error } = useQuery({
    queryKey: ['program-summary', id],
    queryFn: () => apiFetch<{ data: ProgramSummary }>(`/programs/${id}/summary`),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error || !data) {
    return (
      <Card className="py-8 text-center space-y-3">
        <p className="font-semibold">Couldn&apos;t load the summary</p>
        <Link href="/programs" className="text-sm text-indigo-600 hover:underline">Back to programs</Link>
      </Card>
    );
  }

  const s = data.data;
  const muscles = Object.entries(s.setsByMuscle).sort((a, b) => b[1] - a[1]);
  const noData = s.adherence.completedSessions === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/programs"
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{s.program.name}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {s.program.durationWeeks}-week program
            {s.adherence.firstWorkout && ` · ${s.adherence.firstWorkout} → ${s.adherence.lastWorkout}`}
          </p>
        </div>
      </div>

      {noData ? (
        <Card className="py-8 text-center space-y-2">
          <p className="font-semibold text-gray-700 dark:text-gray-200">No sessions logged against this program</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Workouts are linked to a program when you start them with the{' '}
            <span className="font-medium">Start Workout</span> button on a program day. Sessions
            logged before that link existed, or started from the Workouts tab, won&apos;t appear here.
          </p>
        </Card>
      ) : (
        <>
          {/* Adherence */}
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Adherence
              </p>
              {s.adherence.percent != null && (
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{s.adherence.percent}%</p>
              )}
            </div>
            {s.adherence.percent != null && (
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{ width: `${Math.min(100, s.adherence.percent)}%` }}
                />
              </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {s.adherence.completedSessions} of {s.adherence.plannedSessions} planned sessions
              {s.adherence.weeksTrained > 0 && ` · trained in ${s.adherence.weeksTrained} ${s.adherence.weeksTrained === 1 ? 'week' : 'weeks'}`}
            </p>
          </Card>

          {/* Totals */}
          <Card>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Sets', value: String(s.totals.sets) },
                { label: 'Reps', value: String(s.totals.totalReps) },
                { label: `Volume (${unit})`, value: vol(s.totals.volumeKg) },
                { label: 'Minutes', value: String(s.totals.durationMin) },
              ].map((t) => (
                <div key={t.label}>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{t.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* PRs */}
          {s.personalRecords.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 space-y-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {s.personalRecords.length} personal {s.personalRecords.length === 1 ? 'record' : 'records'} during this program
                </p>
              </div>
              <ul className="space-y-1">
                {s.personalRecords.map((pr, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-amber-900 dark:text-amber-200 truncate">
                      {pr.exerciseName}
                      <span className="text-amber-700/70 dark:text-amber-400/70"> · {PR_LABEL[pr.recordType] ?? pr.recordType}</span>
                    </span>
                    <span className="font-semibold text-amber-900 dark:text-amber-200 shrink-0">
                      {pr.recordType === 'MAX_REPS' ? `${pr.value} reps` : `${w(pr.value)} ${unit}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Per-exercise progress */}
          {s.exercises.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Exercise progress (first → last session)
              </p>
              <Card className="divide-y divide-gray-100 dark:divide-gray-800 !p-0">
                {s.exercises.map((ex) => (
                  <div key={ex.exerciseId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ex.name}</p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {ex.sessions} {ex.sessions === 1 ? 'session' : 'sessions'} · {ex.sets} sets · {vol(ex.volumeKg)} {unit}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {ex.firstTopWeightKg != null && ex.lastTopWeightKg != null ? (
                        <>
                          <p className="text-sm font-semibold">
                            {w(ex.firstTopWeightKg)} → {w(ex.lastTopWeightKg)} {unit}
                          </p>
                          <Change value={ex.changeKg} format={(v) => `${w(Math.abs(v))} ${unit}`} />
                        </>
                      ) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500">bodyweight</p>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* Volume by muscle */}
          {muscles.length > 0 && (
            <Card className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Sets per muscle group
              </p>
              <div className="flex flex-wrap gap-1.5">
                {muscles.map(([muscle, count]) => (
                  <span
                    key={muscle}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {(MUSCLE_GROUP_LABELS as Record<string, string>)[muscle] ?? muscle}
                    <span className="ml-1 font-semibold">{count}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <Button onClick={() => router.push('/programs')} className="w-full">Done</Button>
    </div>
  );
}

function Change({ value, format }: { value: number | null; format: (v: number) => string }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  const tone = flat
    ? 'text-gray-400 dark:text-gray-500'
    : value > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon className="h-3 w-3" />
      {flat ? 'no change' : format(value)}
    </span>
  );
}
