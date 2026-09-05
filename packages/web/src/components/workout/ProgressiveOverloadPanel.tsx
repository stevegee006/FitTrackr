'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { parseDateLocal } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { Card } from '@/components/ui/Card';
import { Sparkles, X, RefreshCw } from 'lucide-react';

interface ProgressiveOverloadPanelProps {
  exerciseId: string;
  exerciseName: string;
  workoutId: string;
  units: 'METRIC' | 'IMPERIAL';
  repRangeMin?: number | null;
  repRangeMax?: number | null;
  onClose: () => void;
}

interface HistorySet {
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  isWarmup: boolean;
}

interface HistorySession {
  date: string;
  sets: HistorySet[];
}

interface AiSuggestion {
  strategy: 'increase_weight' | 'increase_reps' | 'increase_sets' | 'maintain' | 'deload';
  suggestion: string;
  targetWeightKg: number | null;
  targetRepsRange: string | null;
  /** Absent on an older API. */
  targetSets?: number | null;
}

const STRATEGY_STYLES: Record<AiSuggestion['strategy'], { label: string; className: string }> = {
  increase_weight: { label: 'Increase Weight', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  increase_reps:   { label: 'Increase Reps',   className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  increase_sets:   { label: 'Add a Set',       className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
  maintain:        { label: 'Maintain',         className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  deload:          { label: 'Deload',           className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
};

export function ProgressiveOverloadPanel({
  exerciseId,
  exerciseName,
  workoutId,
  units,
  repRangeMin,
  repRangeMax,
  onClose,
}: ProgressiveOverloadPanelProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiSuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['exercise-history', exerciseId, workoutId],
    queryFn: () =>
      apiFetch<{ data: HistorySession[] }>(
        `/exercises/${exerciseId}/history?limit=8&excludeWorkoutId=${workoutId}`,
      ),
  });

  function displayWeight(kg: number): string {
    if (units === 'IMPERIAL') {
      return `${(kg * 2.20462).toFixed(1)} lbs`;
    }
    return `${kg.toFixed(1)} kg`;
  }

  function formatSets(sets: HistorySet[]): string {
    const working = sets.filter((s) => !s.isWarmup);
    if (working.length === 0) return '—';

    const weights = working.map((s) => s.weightKg);
    const allSameWeight = weights.every((w) => w === weights[0]);

    if (allSameWeight && weights[0] !== null) {
      const repCounts = working.map((s) => s.reps ?? 0);
      const allSameReps = repCounts.every((r) => r === repCounts[0]);
      const weightStr = displayWeight(weights[0]);
      if (allSameReps) {
        return `${working.length}×${repCounts[0]} @ ${weightStr}`;
      }
      return working.map((s) => `${s.reps ?? '?'}@${weightStr}`).join(' / ');
    }

    return working
      .map((s) => {
        const w = s.weightKg !== null ? displayWeight(s.weightKg) : '—';
        return `${s.reps ?? '?'}@${w}`;
      })
      .join(' / ');
  }

  function getBestWeight(sets: HistorySet[]): string {
    const working = sets.filter((s) => !s.isWarmup && s.weightKg !== null);
    if (working.length === 0) return '—';
    const maxKg = Math.max(...working.map((s) => s.weightKg as number));
    return displayWeight(maxKg);
  }

  function formatDate(iso: string): string {
    const d = parseDateLocal(iso.split('T')[0]);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function fetchAiSuggestion() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch<{ data: AiSuggestion }>(
        `/exercises/${exerciseId}/ai-suggest?excludeWorkoutId=${workoutId}`,
        { method: 'POST' },
      );
      setAiResult(res.data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setAiError(err.message);
      } else {
        setAiError('Something went wrong. Please try again.');
      }
    } finally {
      setAiLoading(false);
    }
  }

  function handleRefresh() {
    setAiResult(null);
    setAiError(null);
    fetchAiSuggestion();
  }

  const sessions = historyData?.data ?? [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{exerciseName}</span>
          {repRangeMin != null && repRangeMax != null && (
            <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {repRangeMin}–{repRangeMax} reps target
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pt-3 pb-1">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          Recent History
        </p>

        {historyLoading ? (
          <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
            No previous sessions found for this exercise.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 dark:text-gray-500 text-left">
                  <th className="pb-1 pr-3 font-medium">Date</th>
                  <th className="pb-1 pr-3 font-medium">Sets</th>
                  <th className="pb-1 font-medium">Best</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {sessions.map((session) => (
                  <tr key={session.date}>
                    <td className="py-1 pr-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(session.date)}
                    </td>
                    <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">
                      {formatSets(session.sets)}
                    </td>
                    <td className="py-1 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {getBestWeight(session.sets)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        {!aiResult && !aiLoading && (
          <button
            onClick={fetchAiSuggestion}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-medium transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Get AI Suggestion
          </button>
        )}

        {aiLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-1">
            <Spinner className="h-4 w-4" />
            <span>Analyzing your training history...</span>
          </div>
        )}

        {aiError && !aiLoading && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {aiError}
          </div>
        )}

        {aiResult && !aiLoading && (
          <Card className="mt-1">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${(STRATEGY_STYLES[aiResult.strategy] ?? STRATEGY_STYLES['maintain']).className}`}
              >
                {(STRATEGY_STYLES[aiResult.strategy] ?? STRATEGY_STYLES['maintain']).label}
              </span>
              <button
                onClick={handleRefresh}
                className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
                aria-label="Refresh suggestion"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {aiResult.suggestion}
            </p>

            {(aiResult.targetWeightKg !== null || aiResult.targetRepsRange !== null || aiResult.targetSets != null) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {aiResult.targetWeightKg !== null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Target weight:</span>{' '}
                    {displayWeight(aiResult.targetWeightKg)}
                  </p>
                )}
                {aiResult.targetRepsRange !== null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Target reps:</span>{' '}
                    {aiResult.targetRepsRange}
                  </p>
                )}
                {aiResult.targetSets != null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Target sets:</span>{' '}
                    {aiResult.targetSets}
                  </p>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
