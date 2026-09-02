'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { MUSCLE_GROUP_LABELS } from '@fittrackr/shared';
import {
  ChevronLeft, Sparkles, TrendingUp, AlertTriangle, Lightbulb, Target, RefreshCw,
} from 'lucide-react';

const LB_PER_KG = 2.20462;
const DAYS = 30;

interface CoachResponse {
  window: {
    days: number;
    sessions: number;
    setsByMuscle: Record<string, number>;
    totalSets: number;
    totalVolumeKg: number;
    prs: Array<{ exercise: string; recordType: string; value: number }>;
  };
  model: string;
  review: {
    headline: string;
    wins: string[];
    concerns: string[];
    suggestions: Array<{ title: string; detail: string }>;
    focusNextWeek: string | null;
  };
}

export default function CoachPage() {
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });
  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const unit = isImperial ? 'lbs' : 'kg';
  const vol = (kg: number) => Math.round(isImperial ? kg * LB_PER_KG : kg).toLocaleString();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['coach-review', DAYS],
    queryFn: () => apiFetch<{ data: CoachResponse }>(`/coach/review?days=${DAYS}`, { timeout: 120_000 }),
    // Each fetch costs an AI call, so hold the result for the session rather
    // than re-spending every time the page is revisited. Refresh is manual.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });

  const header = (
    <div className="flex items-center gap-3">
      <Link
        href="/dashboard"
        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold truncate flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          AI Coach
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">Your last {DAYS} days of training</p>
      </div>
      {data && (
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          title="Run again"
          aria-label="Run the review again"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <Card className="py-12 text-center space-y-3">
          <Spinner />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Reading your last {DAYS} days…
          </p>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    const err = error as any;
    const noData = err?.code === 'NO_TRAINING_DATA';
    return (
      <div className="space-y-4">
        {header}
        <Card className="py-10 text-center space-y-3">
          <p className="font-semibold text-gray-700 dark:text-gray-200">
            {noData ? 'Nothing to review yet' : 'Couldn’t get a review'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {err?.message ?? 'Something went wrong.'}
          </p>
          {!noData && (
            <button
              type="button"
              onClick={() => refetch()}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Try again
            </button>
          )}
        </Card>
      </div>
    );
  }

  const { window: w, review, model } = data.data;
  const muscles = Object.entries(w.setsByMuscle).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {header}

      <Card className="border-indigo-200 bg-indigo-50/60 dark:border-indigo-800/50 dark:bg-indigo-950/30">
        <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">{review.headline}</p>
      </Card>

      {/* The facts the review is based on */}
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Sessions', value: String(w.sessions) },
            { label: 'Sets', value: String(w.totalSets) },
            { label: `Volume (${unit})`, value: vol(w.totalVolumeKg) },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{t.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}</p>
            </div>
          ))}
        </div>
        {muscles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {muscles.map(([m, n]) => (
              <span
                key={m}
                className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {(MUSCLE_GROUP_LABELS as Record<string, string>)[m] ?? m}
                <span className="ml-1 font-semibold">{n}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {review.wins.length > 0 && (
        <Section
          icon={<TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          title="Going well"
          items={review.wins}
        />
      )}

      {review.concerns.length > 0 && (
        <Section
          icon={<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          title="Worth watching"
          items={review.concerns}
        />
      )}

      {review.suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <Lightbulb className="h-4 w-4 text-indigo-500" />
            Suggestions
          </p>
          {review.suggestions.map((sug, i) => (
            <Card key={i} className="space-y-1">
              {sug.title && <p className="font-semibold text-sm">{sug.title}</p>}
              {sug.detail && (
                <p className="text-sm text-gray-600 dark:text-gray-300">{sug.detail}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {review.focusNextWeek && (
        <Card className="border-indigo-200 dark:border-indigo-800/50 space-y-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <Target className="h-4 w-4 text-indigo-500" />
            Next week
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-200">{review.focusNextWeek}</p>
        </Card>
      )}

      <p className="text-center text-[11px] text-gray-400 dark:text-gray-500 pb-2">
        Generated by {model} from your logged sets. Not medical advice.
      </p>
    </div>
  );
}

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {icon}
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-200">
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
