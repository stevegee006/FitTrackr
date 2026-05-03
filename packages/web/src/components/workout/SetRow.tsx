'use client';

import { useState } from 'react';
import { MathInput } from '@/components/ui/MathInput';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { WorkoutSet } from '@fittrackr/shared';
import { Trash2 } from 'lucide-react';

interface SetRowProps {
  set: WorkoutSet;
  workoutId: string;
  setIndex: number;
  units: 'METRIC' | 'IMPERIAL';
  onDeleted: () => void;
}

export function SetRow({ set, workoutId, setIndex, units, onDeleted }: SetRowProps) {
  const queryClient = useQueryClient();
  const isImperial = units === 'IMPERIAL';

  const displayWeight = set.weightKg != null
    ? isImperial ? Math.round(set.weightKg * 2.20462 * 10) / 10 : set.weightKg
    : null;

  const updateMutation = useMutation({
    mutationFn: (data: { reps?: number; weightKg?: number; rpe?: number }) =>
      apiFetch(`/workouts/${workoutId}/sets/${set.id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/workouts/${workoutId}/sets/${set.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] });
      onDeleted();
    },
  });

  return (
    <div className={`flex items-center gap-2 py-1.5 ${set.isWarmup ? 'opacity-60' : ''}`}>
      <span className="w-6 text-center text-xs font-medium text-gray-500 shrink-0">
        {set.isWarmup ? 'W' : setIndex}
      </span>

      <MathInput
        className="w-20 text-center text-sm"
        placeholder={isImperial ? 'lbs' : 'kg'}
        defaultValue={displayWeight != null ? String(displayWeight) : ''}
        onCommit={(val) => {
          const lbsOrKg = parseFloat(val);
          if (!isNaN(lbsOrKg)) {
            const weightKg = isImperial ? lbsOrKg / 2.20462 : lbsOrKg;
            updateMutation.mutate({ weightKg: Math.round(weightKg * 100) / 100 });
          }
        }}
      />

      <span className="text-gray-400 text-xs shrink-0">×</span>

      <MathInput
        className="w-16 text-center text-sm"
        placeholder="reps"
        defaultValue={set.reps != null ? String(set.reps) : ''}
        onCommit={(val) => {
          const reps = parseInt(val);
          if (!isNaN(reps)) updateMutation.mutate({ reps });
        }}
      />

      <MathInput
        className="w-14 text-center text-sm"
        placeholder="RPE"
        defaultValue={set.rpe != null ? String(set.rpe) : ''}
        onCommit={(val) => {
          const rpe = parseFloat(val);
          if (!isNaN(rpe) && rpe >= 1 && rpe <= 10) updateMutation.mutate({ rpe });
        }}
      />

      <button
        type="button"
        onClick={() => deleteMutation.mutate()}
        className="ml-auto p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
