'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
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
  const [value, setValue] = useState(
    currentMin != null && currentMin > 0 && currentMin <= MAX_DURATION_MIN ? String(currentMin) : '',
  );
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
    const n = Math.round(parseFloat(value));
    if (!Number.isFinite(n) || n < 1) {
      setError('Enter a duration of at least 1 minute.');
      return;
    }
    if (n > MAX_DURATION_MIN) {
      setError(`That's over ${MAX_DURATION_MIN / 60} hours — enter ${MAX_DURATION_MIN} or less.`);
      return;
    }
    setError(null);
    mutation.mutate(n);
  }

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
              How long the session actually took, in minutes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DURATION_MIN}
            value={value}
            autoFocus
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="60"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-center text-lg font-semibold bg-white dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">min</span>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

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
