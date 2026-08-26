'use client';

import { useState, useEffect } from 'react';
import { MathInput } from '@/components/ui/MathInput';
import { PlateCalculator } from '@/components/workout/PlateCalculator';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { WorkoutSet } from '@fittrackr/shared';
import { Calculator, Check, Trash2 } from 'lucide-react';

interface SetRowProps {
  set: WorkoutSet;
  workoutId: string;
  setIndex: number;
  units: 'METRIC' | 'IMPERIAL';
  onDeleted: () => void;
  onSetLogged?: () => void;
  isCardio?: boolean;
}

const cardioInputCls =
  'text-center text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400';

export function SetRow({ set, workoutId, setIndex, units, onDeleted, onSetLogged, isCardio }: SetRowProps) {
  const queryClient = useQueryClient();
  const isImperial = units === 'IMPERIAL';

  function toDisplayWeight(kg: number | null) {
    if (kg == null) return '';
    return String(isImperial ? Math.round(kg * 2.20462 * 10) / 10 : kg);
  }

  function toDisplayDistance(m: number | null | undefined) {
    if (m == null) return '';
    if (isImperial) return String(Math.round((m / 1609.344) * 100) / 100);
    return String(Math.round((m / 1000) * 100) / 100);
  }

  const [weightVal, setWeightVal] = useState(() => toDisplayWeight(set.weightKg));
  const [repsVal, setRepsVal] = useState(set.reps != null ? String(set.reps) : '');
  const [rpeVal, setRpeVal] = useState(set.rpe != null ? String(set.rpe) : '');

  const [durationMinVal, setDurationMinVal] = useState(() =>
    set.durationSec != null ? String(Math.floor(set.durationSec / 60)) : ''
  );
  const [durationSecVal, setDurationSecVal] = useState(() =>
    set.durationSec != null ? String(set.durationSec % 60) : ''
  );
  const [distanceVal, setDistanceVal] = useState(() => toDisplayDistance(set.distanceM));

  useEffect(() => {
    setWeightVal(toDisplayWeight(set.weightKg));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.weightKg, isImperial]);

  useEffect(() => {
    setRepsVal(set.reps != null ? String(set.reps) : '');
  }, [set.reps]);

  useEffect(() => {
    setRpeVal(set.rpe != null ? String(set.rpe) : '');
  }, [set.rpe]);

  useEffect(() => {
    setDurationMinVal(set.durationSec != null ? String(Math.floor(set.durationSec / 60)) : '');
    setDurationSecVal(set.durationSec != null ? String(set.durationSec % 60) : '');
  }, [set.durationSec]);

  useEffect(() => {
    setDistanceVal(toDisplayDistance(set.distanceM));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.distanceM, isImperial]);

  const [showCalc, setShowCalc] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: {
      reps?: number;
      weightKg?: number;
      rpe?: number;
      isWarmup?: boolean;
      isCompleted?: boolean;
      durationSec?: number;
      distanceM?: number;
    }) =>
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

  function commitDuration() {
    const mins = parseInt(durationMinVal) || 0;
    const secs = parseInt(durationSecVal) || 0;
    const total = mins * 60 + secs;
    if (total >= 0) updateMutation.mutate({ durationSec: total });
  }

  function commitDistance() {
    const val = parseFloat(distanceVal);
    if (!isNaN(val) && val >= 0) {
      const meters = isImperial ? Math.round(val * 1609.344) : Math.round(val * 1000);
      updateMutation.mutate({ distanceM: meters });
    }
  }

  function handleToggleComplete() {
    const completing = !set.isCompleted;
    if (completing) {
      if (isCardio) {
        commitDuration();
        commitDistance();
      } else {
        commitWeight();
        commitReps();
      }
      commitRpe();
      updateMutation.mutate({ isCompleted: true });
      if (!set.isWarmup) onSetLogged?.();
    } else {
      updateMutation.mutate({ isCompleted: false });
    }
  }

  return (
    <div className={`flex flex-col transition-opacity ${set.isWarmup ? 'opacity-50' : set.isCompleted ? 'opacity-70' : ''}`}>
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

        {isCardio ? (
          <>
            <input
              type="number"
              inputMode="numeric"
              className={`w-12 ${cardioInputCls}`}
              placeholder="min"
              value={durationMinVal}
              onChange={e => setDurationMinVal(e.target.value)}
              onBlur={commitDuration}
            />
            <span className="text-sm text-gray-400 shrink-0">:</span>
            <input
              type="number"
              inputMode="numeric"
              className={`w-12 ${cardioInputCls}`}
              placeholder="sec"
              value={durationSecVal}
              onChange={e => setDurationSecVal(e.target.value)}
              onBlur={commitDuration}
            />
            <input
              type="number"
              inputMode="numeric"
              className={`w-20 ${cardioInputCls}`}
              placeholder={isImperial ? 'mi' : 'km'}
              value={distanceVal}
              onChange={e => setDistanceVal(e.target.value)}
              onBlur={commitDistance}
            />
          </>
        ) : (
          <>
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
          </>
        )}

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
          onClick={handleToggleComplete}
          title={set.isCompleted ? 'Mark incomplete' : 'Complete set'}
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border-2 transition-all ${
            set.isCompleted
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-emerald-400'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => deleteMutation.mutate()}
          className="ml-auto p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {!isCardio && showCalc && (
        <PlateCalculator
          weightKg={set.weightKg}
          units={units}
          exerciseId={set.exerciseId}
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
