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

  const [weightVal, setWeightVal] = useState(displayWeight != null ? String(displayWeight) : '');
  const [repsVal, setRepsVal] = useState(set.reps != null ? String(set.reps) : '');
  const [rpeVal, setRpeVal] = useState(set.rpe != null ? String(set.rpe) : '');

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

  function commitWeight() {
    const lbsOrKg = parseFloat(weightVal);
    if (!isNaN(lbsOrKg)) {
      const weightKg = isImperial ? lbsOrKg / 2.20462 : lbsOrKg;
      updateMutation.mutate({ weightKg: Math.round(weightKg * 100) / 100 });
    }
  }

  function commitReps() {
    const reps = parseInt(repsVal);
    if (!isNaN(reps)) updateMutation.mutate({ reps });
  }

  function commitRpe() {
    const rpe = parseFloat(rpeVal);
    if (!isNaN(rpe) && rpe >= 1 && rpe <= 10) updateMutation.mutate({ rpe });
  }

  return (
    <div className={`flex items-center gap-2 py-1.5 ${set.isWarmup ? 'opacity-60' : ''}`}>
      <span className="w-6 text-center text-xs font-medium text-gray-500 shrink-0">
        {set.isWarmup ? 'W' : setIndex}
      </span>

      <MathInput
        className="w-20 text-center text-sm"
        placeholder={isImperial ? 'lbs' : 'kg'}
        value={weightVal}
        onChange={setWeightVal}
        onBlur={commitWeight}
      />

      <span className="text-gray-400 text-xs shrink-0">×</span>

      <MathInput
        className="w-16 text-center text-sm"
        placeholder="reps"
        value={repsVal}
        onChange={setRepsVal}
        onBlur={commitReps}
      />

      <MathInput
        className="w-14 text-center text-sm"
        placeholder="RPE"
        value={rpeVal}
        onChange={setRpeVal}
        onBlur={commitRpe}
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
