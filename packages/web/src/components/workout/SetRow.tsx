'use client';

import { useState } from 'react';
import { MathInput } from '@/components/ui/MathInput';
import { PlateCalculator } from '@/components/workout/PlateCalculator';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { WorkoutSet } from '@fittrackr/shared';
import { Calculator, Check, CheckCheck, Trash2 } from 'lucide-react';

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
  const [showCalc, setShowCalc] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: { reps?: number; weightKg?: number; rpe?: number; isWarmup?: boolean }) =>
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

  function handleLogSet() {
    commitWeight();
    commitReps();
    commitRpe();
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  return (
    <div className={`flex flex-col ${set.isWarmup ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 py-1.5">
        <button
          type="button"
          onClick={() => updateMutation.mutate({ isWarmup: !set.isWarmup })}
          title={set.isWarmup ? 'Mark as working set' : 'Mark as warmup'}
          className={`w-6 text-center text-xs font-semibold shrink-0 transition-colors rounded ${
            set.isWarmup
              ? 'text-amber-500 dark:text-amber-400 hover:text-amber-700'
              : 'text-gray-500 hover:text-amber-500'
          }`}
        >
          {set.isWarmup ? 'W' : setIndex}
        </button>

        <MathInput
          className="w-20 text-center text-sm"
          placeholder={isImperial ? 'lbs' : 'kg'}
          value={weightVal}
          onChange={setWeightVal}
          onBlur={commitWeight}
          hideOps={true}
        />

        <button
          type="button"
          onClick={() => setShowCalc((v) => !v)}
          className="p-1 text-gray-400 hover:text-indigo-500 transition-colors shrink-0"
        >
          <Calculator className="h-3.5 w-3.5" />
        </button>

        <MathInput
          className="w-16 text-center text-sm"
          placeholder="reps"
          value={repsVal}
          onChange={setRepsVal}
          onBlur={commitReps}
          hideOps={true}
        />

        <MathInput
          className="w-14 text-center text-sm"
          placeholder="RPE"
          value={rpeVal}
          onChange={setRpeVal}
          onBlur={commitRpe}
          hideOps={true}
        />

        <button
          type="button"
          onClick={handleLogSet}
          className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors shrink-0"
        >
          {saved ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => deleteMutation.mutate()}
          className="ml-auto p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showCalc && (
        <PlateCalculator
          weightKg={set.weightKg}
          units={units}
          onClose={() => setShowCalc(false)}
          onApply={(kg) => {
            const display = isImperial ? Math.round(kg * 2.20462 * 10) / 10 : kg;
            setWeightVal(String(display));
            updateMutation.mutate({ weightKg: Math.round(kg * 100) / 100 });
            setShowCalc(false);
          }}
        />
      )}
    </div>
  );
}
