'use client';

import { useState, useEffect } from 'react';
import { MathInput } from '@/components/ui/MathInput';
import { PlateCalculator } from '@/components/workout/PlateCalculator';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Workout, WorkoutSet } from '@fittrackr/shared';
import { Calculator, Check, Trash2 } from 'lucide-react';

/** Shape of the `['workout', id]` query the logger page owns. */
type WorkoutQuery = { data: Workout & { sets: WorkoutSet[] } };

interface SetPatch {
  reps?: number;
  weightKg?: number;
  rpe?: number;
  isWarmup?: boolean;
  isCompleted?: boolean;
  durationSec?: number;
  distanceM?: number;
}

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

/**
 * Column headers for a list of SetRows.
 *
 * Lives in this file, and mirrors the row's flex structure and widths exactly
 * (w-6 index, w-20 weight + calculator button, w-16 reps, w-14 RPE, w-7 check,
 * trailing delete). If a column width changes in SetRow it has to change here
 * too — that is why the two are kept side by side rather than in separate files.
 */
export function SetRowHeader({ units, isCardio }: { units: 'METRIC' | 'IMPERIAL'; isCardio?: boolean }) {
  const isImperial = units === 'IMPERIAL';
  const cls = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 text-center shrink-0';

  return (
    <div
      aria-hidden
      className="flex items-center gap-2 pb-1 border-b border-gray-100 dark:border-gray-800"
    >
      <span className={`w-6 ${cls}`}>Set</span>

      {isCardio ? (
        <>
          {/* cardio fields are plain inputs with real fixed widths */}
          <span className={`flex-1 min-w-0 ${cls}`}>Min</span>
          <span className="text-sm text-transparent shrink-0" aria-hidden>:</span>
          <span className={`flex-1 min-w-0 ${cls}`}>Sec</span>
          <span className={`flex-1 min-w-0 ${cls}`}>{isImperial ? 'Miles' : 'Km'}</span>
        </>
      ) : (
        <>
          <span className={`flex-1 min-w-0 ${cls}`}>{isImperial ? 'Lbs' : 'Kg'}</span>
          {/* the plate-calculator button: p-1 + a 14px icon = 22px. Inline
              style, not an arbitrary class — a w-[22px] that fails to generate
              collapses to 0 and silently breaks the alignment. */}
          <span className="shrink-0" style={{ width: 22 }} />
          <span className={`flex-1 min-w-0 ${cls}`}>Reps</span>
        </>
      )}

      {!isCardio && <span className={`flex-1 min-w-0 ${cls}`}>RPE</span>}
      {/* completion checkbox (w-7) and the trailing delete button (22px) */}
      <span className="w-7 shrink-0" />
      <span className="ml-auto shrink-0" style={{ width: 22 }} />
    </div>
  );
}

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
  const [saveError, setSaveError] = useState<string | null>(null);

  // All set mutations share a key so `onSettled` can tell whether it is the
  // last one standing before it invalidates — see the note there.
  const mutationKey = ['workout-set', workoutId];

  /**
   * Write the patch straight into the workout cache and hand back the previous
   * cache for rollback.
   *
   * The logger had no optimistic updates anywhere: every blur commit and every
   * checkbox tap fired a PATCH, invalidated `['workout', id]` and waited for
   * the refetch before the UI moved. On gym wifi mid-set that is the single
   * most-felt delay in the app.
   */
  async function applyOptimistic(patch: SetPatch) {
    // Stop an in-flight refetch from landing on top of the patch we are about
    // to write.
    await queryClient.cancelQueries({ queryKey: ['workout', workoutId] });
    const previous = queryClient.getQueryData<WorkoutQuery>(['workout', workoutId]);

    queryClient.setQueryData<WorkoutQuery>(['workout', workoutId], (old) =>
      old
        ? {
            ...old,
            data: {
              ...old.data,
              sets: old.data.sets.map((s) => (s.id === set.id ? { ...s, ...patch } : s)),
            },
          }
        : old
    );

    return { previous };
  }

  /**
   * Only the last set mutation still running gets to invalidate. Otherwise a
   * fast tap sequence (blur commit, then complete) has the earlier request's
   * refetch return data that predates the later one's optimistic patch, and the
   * row visibly flickers back to its old value until that one settles too.
   *
   * `isMutating` still counts the caller here, hence `<= 1`.
   */
  function invalidateIfLast() {
    if (queryClient.isMutating({ mutationKey }) <= 1) {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] });
    }
  }

  const updateMutation = useMutation({
    mutationKey,
    mutationFn: (data: SetPatch) =>
      apiFetch(`/workouts/${workoutId}/sets/${set.id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onMutate: async (data) => {
      setSaveError(null);
      return applyOptimistic(data);
    },
    // Failures used to be completely silent: the checkbox simply didn't tick
    // and nothing said why. Rate-limit (429) and auth errors both landed here.
    // Now the optimistic value has to be put back as well, or the row keeps
    // showing a change the server rejected.
    onError: (err: any, _data, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['workout', workoutId], ctx.previous);
      setSaveError(err?.message ?? 'Could not save.');
    },
    onSettled: invalidateIfLast,
  });

  const deleteMutation = useMutation({
    mutationKey,
    mutationFn: () =>
      apiFetch(`/workouts/${workoutId}/sets/${set.id}`, { method: 'DELETE' }),
    onMutate: async () => {
      setSaveError(null);
      await queryClient.cancelQueries({ queryKey: ['workout', workoutId] });
      const previous = queryClient.getQueryData<WorkoutQuery>(['workout', workoutId]);

      // The server does not renumber the remaining sets on delete, so dropping
      // the row is a faithful preview of what the refetch will return.
      queryClient.setQueryData<WorkoutQuery>(['workout', workoutId], (old) =>
        old
          ? { ...old, data: { ...old.data, sets: old.data.sets.filter((s) => s.id !== set.id) } }
          : old
      );

      return { previous };
    },
    onSuccess: () => onDeleted(),
    onError: (err: any, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['workout', workoutId], ctx.previous);
      setSaveError(err?.message ?? 'Could not delete.');
    },
    onSettled: invalidateIfLast,
  });

  // Field readers are pure so completing a set can send ONE request instead of
  // one per field. Four PATCHes per tap, each invalidating the workout query,
  // was ~8 requests per set — enough to trip the API rate limit during a dense
  // session, at which point every save failed silently.
  function weightPayload() {
    const lbsOrKg = parseFloat(weightVal);
    if (isNaN(lbsOrKg)) return null;
    const weightKg = isImperial ? lbsOrKg / 2.20462 : lbsOrKg;
    return { weightKg: Math.round(weightKg * 100) / 100 };
  }

  function repsPayload() {
    const reps = parseInt(repsVal);
    return isNaN(reps) ? null : { reps };
  }

  function rpePayload() {
    const rpe = parseFloat(rpeVal);
    return !isNaN(rpe) && rpe >= 1 && rpe <= 10 ? { rpe } : null;
  }

  function durationPayload() {
    const mins = parseInt(durationMinVal) || 0;
    const secs = parseInt(durationSecVal) || 0;
    const total = mins * 60 + secs;
    return total >= 0 ? { durationSec: total } : null;
  }

  function distancePayload() {
    const val = parseFloat(distanceVal);
    if (isNaN(val) || val < 0) return null;
    return { distanceM: isImperial ? Math.round(val * 1609.344) : Math.round(val * 1000) };
  }

  function commitWeight() { const p = weightPayload(); if (p) updateMutation.mutate(p); }
  function commitReps() { const p = repsPayload(); if (p) updateMutation.mutate(p); }
  function commitRpe() { const p = rpePayload(); if (p) updateMutation.mutate(p); }
  function commitDuration() { const p = durationPayload(); if (p) updateMutation.mutate(p); }
  function commitDistance() { const p = distancePayload(); if (p) updateMutation.mutate(p); }

  function handleToggleComplete() {
    if (!set.isCompleted) {
      // One request carrying every field plus the completion flag.
      updateMutation.mutate({
        ...(isCardio
          ? { ...durationPayload(), ...distancePayload() }
          : { ...weightPayload(), ...repsPayload() }),
        ...rpePayload(),
        isCompleted: true,
      });
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
              className={`flex-1 min-w-0 ${cardioInputCls}`}
              placeholder="min"
              value={durationMinVal}
              onChange={e => setDurationMinVal(e.target.value)}
              onBlur={commitDuration}
            />
            <span className="text-sm text-gray-400 shrink-0">:</span>
            <input
              type="number"
              inputMode="numeric"
              className={`flex-1 min-w-0 ${cardioInputCls}`}
              placeholder="sec"
              value={durationSecVal}
              onChange={e => setDurationSecVal(e.target.value)}
              onBlur={commitDuration}
            />
            {/* decimal, not numeric: a numeric keypad has no "." so 1.5 km
                could not be typed. step="any" too — type=number defaults to
                step=1, which marks any fractional value invalid. */}
            <input
              type="number"
              inputMode="decimal"
              step="any"
              className={`flex-1 min-w-0 ${cardioInputCls}`}
              placeholder={isImperial ? 'mi' : 'km'}
              value={distanceVal}
              onChange={e => setDistanceVal(e.target.value)}
              onBlur={commitDistance}
            />
          </>
        ) : (
          <>
            {/* Explicit flex columns so SetRowHeader can line up. MathInput
                applies its className to the input, which already carries
                w-full — and cn() is clsx with no tailwind-merge, so a w-20
                here was silently dead. Size the wrapper instead. */}
            <div className="flex-1 min-w-0">
              <MathInput
                className="text-center text-sm"
                placeholder={isImperial ? 'lbs' : 'kg'}
                value={weightVal}
                onChange={setWeightVal}
                onBlur={commitWeight}
                hideOps={true}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowCalc((v) => !v)}
              className="p-1 text-gray-400 hover:text-indigo-500 transition-colors shrink-0"
            >
              <Calculator className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1 min-w-0">
              <MathInput
                className="text-center text-sm"
                placeholder="reps"
                value={repsVal}
                onChange={setRepsVal}
                onBlur={commitReps}
                hideOps={true}
              />
            </div>
          </>
        )}

        {/* No RPE for cardio: time, distance and RPE together squeezed every
            field down on a phone, and RPE means little for a steady walk. */}
        {!isCardio && (
          <div className="flex-1 min-w-0">
            <MathInput
              className="text-center text-sm"
              placeholder="RPE"
              value={rpeVal}
              onChange={setRpeVal}
              onBlur={commitRpe}
              hideOps={true}
            />
          </div>
        )}

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

      {saveError && (
        <p className="pl-8 pb-1 text-[11px] text-red-500">{saveError}</p>
      )}

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
