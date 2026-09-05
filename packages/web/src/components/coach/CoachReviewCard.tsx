'use client';

import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import {
  Sparkles, TrendingUp, AlertTriangle, Lightbulb, Target, RefreshCw,
} from 'lucide-react';

export interface CoachReview {
  headline: string;
  wins: string[];
  concerns: string[];
  suggestions: Array<{ title: string; detail: string }>;
  focusNextWeek: string | null;
}

interface Props {
  title: string;
  /** Shown before the user opts in — this costs an AI call. */
  blurb: string;
  buttonLabel: string;
  review: CoachReview | null;
  model?: string;
  started: boolean;
  isLoading: boolean;
  isFetching?: boolean;
  error?: unknown;
  loadingLabel: string;
  onStart: () => void;
  onRefresh?: () => void;
}

/**
 * One renderer for all three coach reviews — the 30-day block, one week, and
 * one session. They ask different questions of different windows but the
 * answer shape is identical, so the alternative was three copies of this
 * drifting apart.
 *
 * Opt-in by design: nothing is fetched until the button is pressed, because
 * every fetch spends one of the user's own AI credits.
 */
export function CoachReviewCard({
  title, blurb, buttonLabel, review, model, started, isLoading, isFetching,
  error, loadingLabel, onStart, onRefresh,
}: Props) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
        <p className="text-sm font-semibold flex-1">{title}</p>
        {review && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
            title="Regenerate"
            aria-label="Regenerate review"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {!started && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">{blurb}</p>
          <button
            type="button"
            onClick={onStart}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-sm font-semibold transition-all"
          >
            <Sparkles className="h-4 w-4" />
            {buttonLabel}
          </button>
        </>
      )}

      {started && isLoading && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-gray-500 dark:text-gray-400">{loadingLabel}</p>
        </div>
      )}

      {error != null && (
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{(error as Error)?.message || 'Could not get a review.'}</span>
        </div>
      )}

      {review && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{review.headline}</p>

          {review.wins.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" /> Going well
              </p>
              {review.wins.map((w, i) => (
                <p key={i} className="text-xs text-gray-700 dark:text-gray-200">• {w}</p>
              ))}
            </div>
          )}

          {review.concerns.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Worth watching
              </p>
              {review.concerns.map((c, i) => (
                <p key={i} className="text-xs text-gray-700 dark:text-gray-200">• {c}</p>
              ))}
            </div>
          )}

          {review.suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                <Lightbulb className="h-3.5 w-3.5" /> Suggestions
              </p>
              {review.suggestions.map((s, i) => (
                <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
                  <p className="text-xs font-semibold">{s.title}</p>
                  {s.detail && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{s.detail}</p>}
                </div>
              ))}
            </div>
          )}

          {review.focusNextWeek && (
            <div className="flex items-start gap-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 p-2.5">
              <Target className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-900 dark:text-indigo-100">{review.focusNextWeek}</p>
            </div>
          )}

          {model && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Generated by {model}</p>
          )}
        </div>
      )}
    </Card>
  );
}
