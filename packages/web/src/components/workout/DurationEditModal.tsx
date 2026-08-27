'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatDuration, splitDuration } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Clock } from 'lucide-react';

/** Matches the server-side cap in createWorkoutSchema. */
export const MAX_DURATION_MIN = 1440;

interface DurationEditModalProps {
  workoutId: string;
  currentMin: number | null;
  onClose: () => void;
  onSaved?: (min: number) => void;
}

export function DurationEditModal({ workoutId, currentMin, onClose, onSaved }: DurationEditModalProps) {
  const queryClient = useQueryClient();
  // A corrupt stored duration (see the timer fix) must not prefill garbage.
  const usable = currentMin != null && currentMin > 0 && currentMin <= MAX_DURATION_MIN ? currentMin : null;
  const initial = splitDuration(usable);
  const [hours, setHours] = useState(usable == null ? '' : String(initial.hours));
  const [minutes, setMinutes] = useState(usable == null ? '' : String(initial.minutes));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (durationMin: number) =>
      apiFetch(`/workouts/${workoutId}`, {
        method: 'PATCH',
        body: JSON.stringify({ durationMin }),
      }),
    onSuccess: (_res, durationMin) => {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] });
      queryClient.invalidateQueries({ queryKey: ['workout-summary', workoutId] });
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      onSaved?.(durationMin);
      onClose();
    },
    onError: (err: any) => setError(err?.message ?? 'Could not save.'),
  });

  function submit() {
    // Blank counts as zero so "1h" with an empty minutes box works.
    const h = hours.trim() === '' ? 0 : Math.round(Number(hours));
    const m = minutes.trim() === '' ? 0 : Math.round(Number(minutes));

    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) {
      setError('Enter whole numbers.');
      return;
    }
    const total = h * 60 + m;
    if (total < 1) {
      setError('Enter a duration of at least 1 minute.');
      return;
    }
    if (total > MAX_DURATION_MIN) {
      setError(`That's over ${MAX_DURATION_MIN / 60} hours — the maximum is 24h 0m.`);
      return;
    }
    setError(null);
    mutation.mutate(total);
  }

  const previewTotal =
    (hours.trim() === '' ? 0 : Math.round(Number(hours))) * 60 +
    (minutes.trim() === '' ? 0 : Math.round(Number(minutes)));

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-indigo-100 dark:bg-indigo-950/40 shrink-0">
            <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Workout duration</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              How long the session actually took.
            </p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex-1">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hours</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              value={hours}
              autoFocus
              onChange={(e) => { setHours(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-lg font-semibold bg-white dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <span className="pb-3 text-lg font-semibold text-gray-400">:</span>
          <label className="flex-1">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Minutes</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => { setMinutes(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="45"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-lg font-semibold bg-white dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
        </div>

        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : previewTotal > 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {formatDuration(previewTotal)} total
          </p>
        ) : null}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Card>
    </div>
  );
}
