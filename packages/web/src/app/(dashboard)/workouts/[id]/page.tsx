'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { SetRow, SetRowHeader } from '@/components/workout/SetRow';
import { RestTimerModal, type RestContext } from '@/components/workout/RestTimerModal';
import { DurationEditModal, MAX_DURATION_MIN } from '@/components/workout/DurationEditModal';
import { markCelebrate } from '@/components/workout/CelebrationBurst';
import { ExerciseSearchForm } from '@/components/exercise/ExerciseSearchForm';
import { ProgressiveOverloadPanel } from '@/components/workout/ProgressiveOverloadPanel';
import { WORKOUT_TYPE_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Workout, WorkoutSet, Exercise } from '@fittrackr/shared';
import { useAuth } from '@/providers/AuthProvider';
import { parseDateLocal, formatDuration } from '@/lib/utils';
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, Timer, Sparkles, Check, Flame, Pause, Play, Flag, Link2, Unlink2, ArrowUp, ArrowDown, Watch, Pencil, BarChart3, StickyNote } from 'lucide-react';
import Link from 'next/link';

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteConfirmModal({ onConfirm, onCancel, isPending }: { onConfirm: () => void; onCancel: () => void; isPending: boolean }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-red-100 dark:bg-red-900/30 shrink-0">
            <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Delete workout?</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">All sets will be permanently removed.</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Superset badge colours (cycles through a palette) ────────────────────────

const SUPERSET_COLORS = [
  { border: '#f59e0b', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  { border: '#8b5cf6', badge: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' },
  { border: '#ec4899', badge: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300' },
  { border: '#14b8a6', badge: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' },
];

function supersetColor(groupId: string) {
  let hash = 0;
  for (const ch of groupId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return SUPERSET_COLORS[Math.abs(hash) % SUPERSET_COLORS.length];
}

// ─── Watch reminder ───────────────────────────────────────────────────────────
// Gate the workout clock behind an acknowledgement so the watch and the clock
// start together. This is intentionally blocking: it fires once, before the
// clock runs, and never during set logging.

const WATCH_REMINDER_KEY = 'fittrackr_watch_reminder';

/**
 * Longest believable session. Used to reject corrupt persisted timer state:
 * an anchor of 0 makes `Date.now() - anchor` read as ~56 years, which then got
 * saved as the workout's duration.
 */
const MAX_WORKOUT_SECONDS = 24 * 60 * 60;

function watchReminderEnabled(): boolean {
  try {
    return localStorage.getItem(WATCH_REMINDER_KEY) !== 'off';
  } catch {
    return true;
  }
}

function WatchReminderModal({ onConfirm, onDisable }: { onConfirm: () => void; onDisable: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-amber-100 dark:bg-amber-900/30 shrink-0">
            <Watch className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Start your watch</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              The workout clock starts when you tap OK.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
        >
          OK
        </button>
        <button
          type="button"
          onClick={onDisable}
          className="w-full text-xs text-gray-500 dark:text-gray-400 hover:underline"
        >
          Don&apos;t remind me again
        </button>
      </Card>
    </div>
  );
}

interface ExercisePref {
  repRangeMin: number | null;
  repRangeMax: number | null;
  targetSets: number | null;
  /** User's explicit choice; null means infer. */
  isCardio: boolean | null;
  /** The exercise's own category, used when isCardio is null. */
  categoryIsCardio?: boolean;
  /** A cue that follows the exercise session to session. */
  notes?: string | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showExerciseSearch, setShowExerciseSearch] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  // Bumped on every open so the modal remounts and restarts, even if one is
  // already on screen from a previous set.
  const [restTimerKey, setRestTimerKey] = useState(0);
  // Labels the iOS Live Activity. Null when the timer was opened from the
  // header button, where there is no set to name.
  const [restContext, setRestContext] = useState<RestContext | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [clockRunning, setClockRunning] = useState(false);
  const [workoutStarted, setWorkoutStarted] = useState(false);
  const [showWatchReminder, setShowWatchReminder] = useState(false);
  const [showDurationEdit, setShowDurationEdit] = useState(false);
  const [addExerciseError, setAddExerciseError] = useState<string | null>(null);
  const [exerciseActionError, setExerciseActionError] = useState<string | null>(null);
  // Removing every set of an exercise is not undoable, so it is confirmed —
  // an in-page bar rather than window.confirm, which on iOS steals focus and
  // has fired accidentally from a mis-tap on the collapsing header.
  const [confirmDeleteExerciseId, setConfirmDeleteExerciseId] = useState<string | null>(null);
  const startAnchorRef = useRef<number>(0);

  // ── Timer localStorage persistence ──────────────────────────────────────────
  // Key: fittrackr:timer:<workoutId>
  // Value: { anchor: number; isRunning: boolean; pausedElapsed: number }
  //   anchor = wall-clock origin such that elapsed = (Date.now() - anchor) / 1000
  const timerKey = `fittrackr:timer:${id}`;

  function saveTimerState(anchor: number, isRunning: boolean, pausedElapsed = 0) {
    try { localStorage.setItem(timerKey, JSON.stringify({ anchor, isRunning, pausedElapsed })); } catch { /* ignore */ }
  }
  function clearTimerState() {
    try { localStorage.removeItem(timerKey); } catch { /* ignore */ }
  }

  // Restore timer on mount. Every value out of localStorage is validated: a
  // missing or zero anchor previously produced a ~496627 hour clock, which then
  // got written to the workout's durationMin on Finish.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(timerKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { anchor?: number; isRunning?: boolean; pausedElapsed?: number };

      const anchor = Number(parsed.anchor);
      const pausedElapsed = Number(parsed.pausedElapsed);
      const sane = (n: number) => Number.isFinite(n) && n >= 0 && n <= MAX_WORKOUT_SECONDS;

      if (parsed.isRunning) {
        const fromAnchor = Number.isFinite(anchor) && anchor > 0
          ? Math.floor((Date.now() - anchor) / 1000)
          : NaN;
        if (!sane(fromAnchor)) { clearTimerState(); return; }
        startAnchorRef.current = anchor;
        setElapsed(fromAnchor);
        setClockRunning(true);
      } else {
        if (!sane(pausedElapsed)) { clearTimerState(); return; }
        startAnchorRef.current = Date.now() - pausedElapsed * 1000;
        setElapsed(pausedElapsed);
        setClockRunning(false);
      }
      setWorkoutStarted(true);
    } catch {
      clearTimerState();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [editingRepRange, setEditingRepRange] = useState<Map<string, boolean>>(new Map());
  const [repRangeEdits, setRepRangeEdits] = useState<Record<string, { min: string; max: string }>>({});
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [showAiPanel, setShowAiPanel] = useState<string | null>(null);
  // Superset link mode: exerciseId that is currently waiting to be paired
  const [linkingExerciseId, setLinkingExerciseId] = useState<string | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [userExpandedKeys, setUserExpandedKeys] = useState<Set<string>>(new Set());
  const [cardioExercises, setCardioExercises] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => apiFetch<{ data: Workout & { sets: WorkoutSet[] } }>(`/workouts/${id}`),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: 'METRIC' | 'IMPERIAL' } }>('/users/me/settings'),
  });

  const exerciseIds = [...(data?.data?.sets ?? [])].map(s => s.exerciseId).filter((v, i, a) => a.indexOf(v) === i);

  const prefsQuery = useQuery({
    queryKey: ['exercise-prefs', exerciseIds],
    queryFn: async () => {
      const results = await Promise.all(
        exerciseIds.map(eid =>
          apiFetch<{ data: ExercisePref | null }>(
            `/exercises/${eid}/preference`
          ).then(r => [eid, r.data] as const)
        )
      );
      return Object.fromEntries(results) as Record<string, ExercisePref | null>;
    },
    enabled: exerciseIds.length > 0,
  });

  const workout = data?.data;
  // Set by Finish Workout (migration 0009). Workouts logged before that read as
  // open, so an old session still offers Start/Finish — finishing one stamps it.
  const isFinished = workout?.completedAt != null;

  const addSetMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];

      let weightKg: number | null = null;
      let reps: number | null = null;

      if (existingSets.length > 0) {
        const last = existingSets[existingSets.length - 1];
        weightKg = last.weightKg ?? null;
        reps = last.reps ?? null;
      } else {
        try {
          const lastSet = await apiFetch<{ data: { weightKg: number | null; reps: number | null; rpe: number | null } | null }>(
            `/exercises/${exerciseId}/last-set?excludeWorkoutId=${id}`
          );
          weightKg = lastSet.data?.weightKg ?? null;
          reps = lastSet.data?.reps ?? null;
        } catch { /* proceed with null */ }
      }

      return apiFetch(`/workouts/${id}/sets`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, setNumber: existingSets.length + 1, reps, weightKg, isWarmup: false }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setShowExerciseSearch(false);
      setSelectedExercise(null);
    },
  });

  /**
   * Adding an exercise reproduces the last session's working sets — the same
   * number of sets, with reps, weight, RPE and any time/distance carried over —
   * instead of dropping in a single blank set to fill in by hand.
   *
   * Falls back to the saved rep-range preference, then to one empty set.
   */
  const addExerciseMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existing = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];
      // Already in this workout — just append one set, the old behaviour.
      if (existing.length > 0) {
        const last = existing[existing.length - 1];
        return apiFetch(`/workouts/${id}/sets`, {
          method: 'POST',
          body: JSON.stringify({
            exerciseId, setNumber: existing.length + 1,
            reps: last.reps ?? null, weightKg: last.weightKg ?? null, isWarmup: false,
          }),
        });
      }

      type PriorSet = {
        reps: number | null; weightKg: number | null; rpe: number | null;
        durationSec: number | null; distanceM: number | null;
      };

      let template: PriorSet[] = [];
      try {
        const res = await apiFetch<{ data: { sets: PriorSet[] } | null }>(
          `/exercises/${exerciseId}/last-session?excludeWorkoutId=${id}`,
        );
        template = res.data?.sets ?? [];
      } catch { /* no history — fall through */ }

      if (template.length === 0) {
        // No history: use the rep-range preference if one was set.
        let targetSets = 1;
        let reps: number | null = null;
        try {
          const pref = await apiFetch<{ data: { repRangeMin: number | null; targetSets: number | null } | null }>(
            `/exercises/${exerciseId}/preference`,
          );
          targetSets = Math.min(Math.max(pref.data?.targetSets ?? 1, 1), 10);
          reps = pref.data?.repRangeMin ?? null;
        } catch { /* defaults */ }
        template = Array.from({ length: targetSets }, () => ({
          reps, weightKg: null, rpe: null, durationSec: null, distanceM: null,
        }));
      }

      // Sequential so setNumber ordering is deterministic.
      for (let i = 0; i < template.length; i++) {
        const t = template[i];
        await apiFetch(`/workouts/${id}/sets`, {
          method: 'POST',
          body: JSON.stringify({
            exerciseId,
            setNumber: i + 1,
            reps: t.reps ?? null,
            weightKg: t.weightKg ?? null,
            rpe: t.rpe ?? null,
            durationSec: t.durationSec ?? null,
            distanceM: t.distanceM ?? null,
            isWarmup: false,
          }),
        });
      }
    },
    onSuccess: () => {
      setAddExerciseError(null);
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setShowExerciseSearch(false);
      setSelectedExercise(null);
    },
    // Several sets are POSTed in sequence, so a failure can leave the exercise
    // partly added. Say so rather than closing the panel as if it worked.
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setAddExerciseError(err?.message ?? 'Could not add the exercise. Check the sets below.');
    },
  });

  const addWarmupMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];
      const workingSets = existingSets.filter((s) => !s.isWarmup);
      const workingWeight = workingSets.length > 0 ? workingSets[workingSets.length - 1].weightKg : null;
      const warmupWeight = workingWeight != null ? Math.round(workingWeight * 0.5 * 4) / 4 : null;
      return apiFetch(`/workouts/${id}/sets`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, setNumber: existingSets.length + 1, reps: null, weightKg: warmupWeight, isWarmup: true }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const WARMUP_LADDER = [
    { pct: 0.4, reps: 8 },
    { pct: 0.6, reps: 5 },
    { pct: 0.75, reps: 3 },
  ];

  const addWarmupLadderMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const existingSets = workout?.sets?.filter((s) => s.exerciseId === exerciseId) ?? [];
      const workingSets = existingSets.filter((s) => !s.isWarmup);
      let workingWeightKg: number | null = workingSets.length > 0
        ? (workingSets[workingSets.length - 1].weightKg ?? null)
        : null;
      if (workingWeightKg === null) {
        try {
          const lastSet = await apiFetch<{ data: { weightKg: number | null } | null }>(
            `/exercises/${exerciseId}/last-set?excludeWorkoutId=${id}`
          );
          workingWeightKg = lastSet.data?.weightKg ?? null;
        } catch { /* proceed with null */ }
      }
      let setNumber = existingSets.length + 1;
      for (const step of WARMUP_LADDER) {
        const weightKg = workingWeightKg != null ? Math.round(workingWeightKg * step.pct * 4) / 4 : null;
        await apiFetch(`/workouts/${id}/sets`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId, setNumber: setNumber++, reps: step.reps, weightKg, isWarmup: true }),
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      clearTimerState();
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['workout-volume'] });
      router.replace('/workouts');
    },
  });

  // MUST stay above the `if (isLoading) return` guards below — a hook declared
  // after an early return runs conditionally and throws React error #310
  // ("rendered more hooks than during the previous render").
  const cardioModeMutation = useMutation({
    mutationFn: ({ exerciseId, isCardio }: { exerciseId: string; isCardio: boolean }) =>
      apiFetch(`/exercises/${exerciseId}/preference`, {
        method: 'PATCH',
        body: JSON.stringify({ isCardio }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercise-prefs'] }),
  });

  const finishMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/workouts/${id}/finish`, {
        method: 'POST',
        // Only send a duration this session's clock actually measured. Finish
        // is reachable on a workout whose clock never ran in this browser —
        // always sending `max(1, elapsed/60)` would replace a real duration
        // with 1 minute. Still clamped, because a corrupt clock must never be
        // written as the duration (see the timer validation above).
        body: JSON.stringify(
          workoutStarted && elapsed > 0
            ? {
                durationMin: Math.min(
                  MAX_DURATION_MIN,
                  Math.max(1, Math.round(Math.min(elapsed, MAX_WORKOUT_SECONDS) / 60)),
                ),
              }
            : {}
        ),
      }),
    onSuccess: () => {
      // Stop the ticker WITHOUT persisting — pauseClock() saves, so calling it
      // after clearTimerState() re-created the key it had just removed.
      setClockRunning(false);
      clearTimerState();
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['workout-volume'] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      // Finishing lands on the recap rather than the list, with a celebration.
      markCelebrate(id);
      router.replace(`/workouts/${id}/summary`);
    },
  });

  // Finishing is not a one-way door: finish a session, notice a missed set,
  // reopen and add it. Deliberately does NOT clear the recorded duration —
  // reopening is not "unfinishing", and the stored time is still the truth
  // until Finish measures a new one.
  const reopenMutation = useMutation({
    mutationFn: () => apiFetch(`/workouts/${id}/reopen`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
    },
  });

  const saveRepRangeMutation = useMutation({
    mutationFn: ({ exerciseId, repRangeMin, repRangeMax }: { exerciseId: string; repRangeMin: number | null; repRangeMax: number | null }) =>
      apiFetch(`/exercises/${exerciseId}/preference`, {
        method: 'PATCH',
        body: JSON.stringify({ repRangeMin, repRangeMax }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exercise-prefs'] }),
  });

  // Stored on ExercisePreference, so it belongs to the exercise rather than to
  // this workout and shows up again next session.
  const saveNoteMutation = useMutation({
    mutationFn: ({ exerciseId, notes }: { exerciseId: string; notes: string | null }) =>
      apiFetch(`/exercises/${exerciseId}/preference`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      }),
    onSuccess: () => {
      setEditingNote(null);
      queryClient.invalidateQueries({ queryKey: ['exercise-prefs'] });
    },
  });

  const createSupersetMutation = useMutation({
    mutationFn: (exerciseIds: string[]) =>
      apiFetch(`/workouts/${id}/superset`, { method: 'POST', body: JSON.stringify({ exerciseIds }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      setLinkingExerciseId(null);
    },
  });

  const deleteSupersetMutation = useMutation({
    mutationFn: (groupId: string) =>
      apiFetch(`/workouts/${id}/superset/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const reorderMutation = useMutation({
    mutationFn: (exerciseOrder: string[]) =>
      apiFetch(`/workouts/${id}/exercise-order`, { method: 'PATCH', body: JSON.stringify({ exerciseOrder }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout', id] }),
  });

  // One request for the whole exercise. Removing a mis-added exercise used to
  // mean tapping the trash on every set in turn, and the header only vanished
  // on the last one. The server also prunes `exerciseOrder` and dissolves a
  // superset group left with one member — see deleteWorkoutExercise.
  const deleteExerciseMutation = useMutation({
    mutationFn: (exerciseId: string) =>
      apiFetch(`/workouts/${id}/exercises/${exerciseId}`, { method: 'DELETE' }),
    onMutate: async (exerciseId: string) => {
      setExerciseActionError(null);
      await queryClient.cancelQueries({ queryKey: ['workout', id] });
      const previous = queryClient.getQueryData<{ data: Workout & { sets: WorkoutSet[] } }>(['workout', id]);

      queryClient.setQueryData<{ data: Workout & { sets: WorkoutSet[] } }>(['workout', id], (old) =>
        old
          ? {
              ...old,
              data: {
                ...old.data,
                sets: old.data.sets.filter((s) => s.exerciseId !== exerciseId),
                exerciseOrder: (old.data.exerciseOrder ?? []).filter((e) => e !== exerciseId),
              },
            }
          : old
      );

      return { previous };
    },
    onError: (err: any, _exerciseId, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['workout', id], ctx.previous);
      setExerciseActionError(err?.message ?? 'Could not remove that exercise.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', id] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
    },
  });

  // Tick when running
  useEffect(() => {
    if (!clockRunning) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startAnchorRef.current) / 1000));
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [clockRunning]);

  const startClock = useCallback(() => {
    const anchor = Date.now();
    startAnchorRef.current = anchor;
    setElapsed(0);
    setClockRunning(true);
    setWorkoutStarted(true);
    saveTimerState(anchor, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  /**
   * Start Workout goes through the reminder when it's enabled, so the clock and
   * the watch start at the same moment. Only on a fresh start — resuming a
   * paused workout isn't "starting a workout".
   */
  const requestStart = useCallback(() => {
    if (watchReminderEnabled()) setShowWatchReminder(true);
    else startClock();
  }, [startClock]);

  const confirmWatchReminder = useCallback(() => {
    setShowWatchReminder(false);
    startClock();
  }, [startClock]);

  const disableWatchReminder = useCallback(() => {
    try { localStorage.setItem(WATCH_REMINDER_KEY, 'off'); } catch { /* ignore */ }
    setShowWatchReminder(false);
    startClock();
  }, [startClock]);

  const pauseClock = useCallback(() => {
    setClockRunning(false);
    const currentElapsed = Math.floor((Date.now() - startAnchorRef.current) / 1000);
    saveTimerState(startAnchorRef.current, false, currentElapsed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  const resumeClock = useCallback(() => {
    const anchor = Date.now() - elapsed * 1000;
    startAnchorRef.current = anchor;
    setClockRunning(true);
    saveTimerState(anchor, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, timerKey]);

  // Cardio mode comes from the saved preference first, then the exercise's own
  // category, and only then from whether existing sets happen to carry
  // duration/distance. Re-runs when preferences arrive, so a remembered choice
  // applies to a brand-new exercise with no sets yet — previously the mode was
  // inferred from set shape alone and had to be re-toggled every session.
  useEffect(() => {
    const prefs = prefsQuery.data;
    setCardioExercises(prev => {
      const next = new Set(prev);
      for (const [eid, pref] of Object.entries(prefs ?? {})) {
        if (pref?.isCardio === true) next.add(eid);
        else if (pref?.isCardio === false) next.delete(eid);
        else if (pref?.categoryIsCardio) next.add(eid);
      }
      for (const s of workout?.sets ?? []) {
        const pref = prefs?.[s.exerciseId];
        // An explicit "no" wins over the shape of the data.
        if (pref?.isCardio === false) continue;
        if (s.durationSec != null || s.distanceM != null) next.add(s.exerciseId);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout?.id, prefsQuery.data]);

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!workout) return null;

  const units = settingsData?.data?.preferredUnits ?? 'METRIC';

  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const durationDisplay = hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // ─── Collapse helpers ────────────────────────────────────────────────────────
  function isSlotComplete(eids: string[]): boolean {
    const allSets = eids.flatMap(eid => byExercise.get(eid) ?? []);
    const workingSets = allSets.filter(s => !s.isWarmup);
    return workingSets.length > 0 && workingSets.every(s => s.isCompleted);
  }

  function isKeyCollapsed(key: string, eids: string[]): boolean {
    if (collapsedKeys.has(key)) return true;
    if (userExpandedKeys.has(key)) return false;
    return isSlotComplete(eids); // auto-collapse when all done
  }

  function toggleCollapse(key: string, eids: string[]) {
    const collapsed = isKeyCollapsed(key, eids);
    if (collapsed) {
      setUserExpandedKeys(prev => new Set([...prev, key]));
      setCollapsedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      setCollapsedKeys(prev => new Set([...prev, key]));
      setUserExpandedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  function openRestTimer(context?: RestContext) {
    setRestContext(context ?? null);
    setRestTimerKey((k) => k + 1);
    setShowRestTimer(true);
  }

  /**
   * Rest starts after a ROUND, not after every set.
   *
   * In a superset/circuit you move straight to the next exercise in the group,
   * so firing the timer on each set was wrong — it fired mid-round. For a
   * grouped exercise the timer waits until every member's set at this round
   * number is complete. A member with no set at that round is skipped, so an
   * uneven group can't leave the timer permanently un-triggered.
   */
  function handleSetLogged(exerciseId: string, roundNumber: number) {
    // Names the Live Activity. For a superset this is the exercise whose set
    // fired the callback — the last one of the round — which is the one the
    // athlete just put down.
    const working = (byExercise.get(exerciseId) ?? []).filter((x) => !x.isWarmup);
    const context: RestContext = {
      exerciseName: byExercise.get(exerciseId)?.[0]?.exercise?.name ?? 'Exercise',
      setNumber: roundNumber,
      totalSets: working.length,
      workoutName: workout?.name ?? (workout ? WORKOUT_TYPE_LABELS[workout.workoutType] : null) ?? 'Workout',
    };

    const groupId = exerciseToGroup.get(exerciseId);
    if (!groupId) {
      openRestTimer(context);
      return;
    }

    const members = (supersetGroupMap.get(groupId) ?? []).filter((e) => byExercise.has(e));
    const roundComplete = members.every((eid) => {
      // The set that just fired this callback. Its PATCH is optimistic now, but
      // `mutate` applies that asynchronously and this runs in the same tick, so
      // the cached copy still reads incomplete either way — treat it as done.
      if (eid === exerciseId) return true;
      const working = (byExercise.get(eid) ?? []).filter((x) => !x.isWarmup);
      const peer = working[roundNumber - 1];
      return !peer || peer.isCompleted;
    });

    if (roundComplete) openRestTimer(context);
  }

  /**
   * Reorder one exercise INSIDE a superset, leaving the group's position in
   * the workout alone.
   *
   * The persisted order is a single flat array, so this writes the reordered
   * members back into the exact positions the members already occupy and
   * leaves every other entry untouched. That works whether or not the members
   * are contiguous in the array.
   */
  function moveInGroup(memberIds: string[], index: number, direction: -1 | 1, order: string[]) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= memberIds.length) return;

    const reordered = [...memberIds];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    const positions: number[] = [];
    order.forEach((eid, i) => { if (memberIds.includes(eid)) positions.push(i); });

    const next = [...order];
    positions.forEach((pos, i) => { next[pos] = reordered[i]; });
    reorderMutation.mutate(next);
  }

  function moveSlot(slotIndex: number, direction: -1 | 1, currentSlots: Slot[]) {
    const newIndex = slotIndex + direction;
    if (newIndex < 0 || newIndex >= currentSlots.length) return;
    const reordered = [...currentSlots];
    [reordered[slotIndex], reordered[newIndex]] = [reordered[newIndex], reordered[slotIndex]];
    const newOrder = reordered.flatMap(s => s.type === 'single' ? [s.exerciseId] : s.exerciseIds);
    reorderMutation.mutate(newOrder);
  }

  // ─── Group sets by exercise ──────────────────────────────────────────────────
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of workout.sets ?? []) {
    if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
    byExercise.get(set.exerciseId)!.push(set);
  }
  for (const [key, sets] of byExercise) {
    byExercise.set(key, [...sets].sort((a, b) => {
      if (a.isWarmup && !b.isWarmup) return -1;
      if (!a.isWarmup && b.isWarmup) return 1;
      return a.setNumber - b.setNumber;
    }));
  }

  // ─── Build superset group maps ───────────────────────────────────────────────
  const supersetGroupMap = new Map<string, string[]>(); // groupId → ordered exerciseIds
  const exerciseToGroup = new Map<string, string>();    // exerciseId → groupId
  for (const set of workout.sets ?? []) {
    if (!set.supersetGroupId) continue;
    exerciseToGroup.set(set.exerciseId, set.supersetGroupId);
    const group = supersetGroupMap.get(set.supersetGroupId) ?? [];
    if (!group.includes(set.exerciseId)) group.push(set.exerciseId);
    supersetGroupMap.set(set.supersetGroupId, group);
  }

  // ─── Build ordered rendering slots ──────────────────────────────────────────
  type Slot = { type: 'single'; exerciseId: string } | { type: 'group'; groupId: string; exerciseIds: string[] };
  // Use server-persisted order when available, fall back to insertion order
  const savedOrder = workout.exerciseOrder ?? [];
  const exerciseOrder = savedOrder.length > 0
    ? [...savedOrder.filter(eid => byExercise.has(eid)), ...[...byExercise.keys()].filter(eid => !savedOrder.includes(eid))]
    : [...byExercise.keys()];
  const renderedEids = new Set<string>();
  const slots: Slot[] = [];
  for (const eid of exerciseOrder) {
    if (renderedEids.has(eid)) continue;
    const gid = exerciseToGroup.get(eid);
    if (gid) {
      // Members are ordered by their position in the persisted exerciseOrder,
      // not by the order their sets happen to come back in. Without this the
      // group's internal order is whatever the sets array dictates and cannot
      // be changed. Members need NOT be contiguous in the flat array — the
      // group renders at the first member's position either way.
      const groupEids = (supersetGroupMap.get(gid) ?? [eid])
        .filter(e => byExercise.has(e))
        .sort((a, b) => {
          const ia = exerciseOrder.indexOf(a);
          const ib = exerciseOrder.indexOf(b);
          return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
        });
      groupEids.forEach(e => renderedEids.add(e));
      slots.push({ type: 'group', groupId: gid, exerciseIds: groupEids });
    } else {
      renderedEids.add(eid);
      slots.push({ type: 'single', exerciseId: eid });
    }
  }

  // ─── Exercise card body renderer ─────────────────────────────────────────────
  function renderExerciseCard(exerciseId: string, isInGroup = false, collapseKey?: string, moveButtons?: React.ReactNode) {
    const sets = byExercise.get(exerciseId) ?? [];
    const exerciseName = sets[0]?.exercise?.name ?? 'Exercise';
    const primaryMuscle = sets[0]?.exercise?.primaryMuscle ?? 'FULL_BODY';
    const workingSets = sets.filter((s) => !s.isWarmup);
    const pref = prefsQuery.data?.[exerciseId];
    const isEditingRange = editingRepRange.get(exerciseId) ?? false;
    const groupId = exerciseToGroup.get(exerciseId);
    const isLinking = linkingExerciseId === exerciseId;
    const otherExerciseIds = exerciseOrder.filter(e => e !== exerciseId);
    const isCardio = cardioExercises.has(exerciseId);
    const collapsed = collapseKey ? isKeyCollapsed(collapseKey, [exerciseId]) : false;
    const workingSetsDone = sets.filter(s => !s.isWarmup && s.isCompleted).length;
    const workingSetsTotal = sets.filter(s => !s.isWarmup).length;

    const enterRepRangeEdit = () => {
      setRepRangeEdits(prev => ({
        ...prev,
        [exerciseId]: {
          min: pref?.repRangeMin != null ? String(pref.repRangeMin) : '',
          max: pref?.repRangeMax != null ? String(pref.repRangeMax) : '',
        },
      }));
      setEditingRepRange(prev => new Map(prev).set(exerciseId, true));
    };

    const cancelRepRangeEdit = () => {
      setEditingRepRange(prev => { const next = new Map(prev); next.delete(exerciseId); return next; });
    };

    const saveRepRange = () => {
      const edits = repRangeEdits[exerciseId];
      saveRepRangeMutation.mutate({
        exerciseId,
        repRangeMin: edits?.min ? parseInt(edits.min, 10) : null,
        repRangeMax: edits?.max ? parseInt(edits.max, 10) : null,
      });
      cancelRepRangeEdit();
    };

    return (
      <div key={exerciseId} className={isInGroup ? 'border-b border-gray-100 dark:border-gray-800 last:border-b-0' : ''}>
        {/* Exercise header.

            TWO ROWS, not one. Everything used to sit on a single flex line —
            name, rep-range pill, AI, cardio, set count, delete, reorder — and
            on a phone a long name ("Cable Rope Hammer Curls") squeezed the lot:
            the name wrapped to four lines, the pill wrapped mid-word to
            "8-12 / reps", and the set count disappeared behind the trash. The
            name now owns its own row and the controls wrap freely below it. */}
        <div
          className={`px-3 py-2 border-b border-gray-100 dark:border-gray-800 ${collapseKey ? 'cursor-pointer' : ''}`}
          style={{ borderLeftColor: (MUSCLE_GROUP_COLORS as any)[primaryMuscle], borderLeftWidth: 3 }}
          onClick={collapseKey ? () => toggleCollapse(collapseKey, [exerciseId]) : undefined}
        >
          <div className="flex items-center gap-2">
            {collapseKey && (
              collapsed
                ? <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                : <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            )}

            <p className="text-sm font-semibold flex-1 min-w-0">{exerciseName}</p>

            {collapsed && (
              workingSetsDone === workingSetsTotal && workingSetsTotal > 0
                ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0"><Check className="h-3 w-3" />Done</span>
                : <span className="text-xs text-gray-400 shrink-0">{workingSetsDone}/{workingSetsTotal}</span>
            )}

            {/* Reorder stays on the title row: it is a vertical pair, so it
                costs no horizontal space the controls row needs. */}
            {!collapsed && moveButtons && (
              <div className="shrink-0" onClick={e => e.stopPropagation()}>{moveButtons}</div>
            )}
          </div>

          {!collapsed && (
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {/* Rep range display / edit */}
              {isEditingRange ? (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <input
                    type="number" min={1}
                    value={repRangeEdits[exerciseId]?.min ?? ''}
                    onChange={e => setRepRangeEdits(prev => ({ ...prev, [exerciseId]: { ...prev[exerciseId]!, min: e.target.value } }))}
                    className="w-14 text-xs text-center border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 bg-white dark:bg-gray-800"
                    placeholder="min"
                  />
                  <span className="text-xs text-gray-400">–</span>
                  <input
                    type="number" min={1}
                    value={repRangeEdits[exerciseId]?.max ?? ''}
                    onChange={e => setRepRangeEdits(prev => ({ ...prev, [exerciseId]: { ...prev[exerciseId]!, max: e.target.value } }))}
                    className="w-14 text-xs text-center border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 bg-white dark:bg-gray-800"
                    placeholder="max"
                  />
                  <button type="button" onClick={saveRepRange}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
                    Save
                  </button>
                  <button type="button" onClick={cancelRepRangeEdit}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300">
                    Cancel
                  </button>
                </div>
              ) : pref?.repRangeMin != null || pref?.repRangeMax != null ? (
                <button type="button" onClick={e => { e.stopPropagation(); enterRepRangeEdit(); }}
                  className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                  {pref?.repRangeMin}–{pref?.repRangeMax} reps
                </button>
              ) : (
                <button type="button" onClick={e => { e.stopPropagation(); enterRepRangeEdit(); }} className="text-xs text-gray-400 hover:text-indigo-500">
                  + range
                </button>
              )}

              {/* AI Progressive Overload */}
              <button type="button"
                onClick={e => { e.stopPropagation(); setShowAiPanel(showAiPanel === exerciseId ? null : exerciseId); }}
                className={`p-1 rounded-lg transition-colors ${showAiPanel === exerciseId ? 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40' : 'text-gray-400 hover:text-indigo-500'}`}
                title="AI progressive overload">
                <Sparkles className="h-3.5 w-3.5" />
              </button>

              {/* Cardio toggle */}
              <button type="button"
                onClick={e => {
                  e.stopPropagation();
                  const nowCardio = !isCardio;
                  setCardioExercises(prev => {
                    const n = new Set(prev);
                    if (nowCardio) n.add(exerciseId); else n.delete(exerciseId);
                    return n;
                  });
                  // Remembered per exercise, so a walk stays a walk next time.
                  cardioModeMutation.mutate({ exerciseId, isCardio: nowCardio });
                }}
                className={`p-1 rounded-lg transition-colors ${isCardio ? 'text-sky-600 bg-sky-100 dark:bg-sky-900/40' : 'text-gray-400 hover:text-sky-500'}`}
                title={isCardio ? 'Switch to strength mode' : 'Switch to cardio mode'}>
                <Timer className="h-3.5 w-3.5" />
              </button>

              {/* Exercise note */}
              <button type="button"
                onClick={e => {
                  e.stopPropagation();
                  setNoteDraft(pref?.notes ?? '');
                  setEditingNote(editingNote === exerciseId ? null : exerciseId);
                }}
                className={`p-1 rounded-lg transition-colors ${
                  pref?.notes
                    ? 'text-amber-600 bg-amber-100 dark:bg-amber-900/40'
                    : 'text-gray-400 hover:text-amber-500'
                }`}
                title={pref?.notes ? 'Edit note' : 'Add a note for this exercise'}>
                <StickyNote className="h-3.5 w-3.5" />
              </button>

              <span className="text-xs text-gray-500">{workingSets.length} sets</span>

              {/* Remove the whole exercise */}
              <button type="button"
                onClick={e => { e.stopPropagation(); setConfirmDeleteExerciseId(exerciseId); }}
                className="p-1 rounded-lg text-gray-400 hover:text-red-500 transition-colors ml-auto"
                title="Remove exercise from this workout">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* The note itself. Shown, not hidden behind the icon: a cue you have to
            go looking for is a cue you will not read mid-set. */}
        {!collapsed && editingNote !== exerciseId && pref?.notes && (
          <button type="button"
            onClick={e => {
              e.stopPropagation();
              setNoteDraft(pref.notes ?? '');
              setEditingNote(exerciseId);
            }}
            className="w-full text-left px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-amber-50/60 dark:bg-amber-950/20">
            <p className="text-xs text-amber-900 dark:text-amber-200 whitespace-pre-wrap">{pref.notes}</p>
          </button>
        )}

        {!collapsed && editingNote === exerciseId && (
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 space-y-2"
            onClick={e => e.stopPropagation()}>
            <textarea
              autoFocus
              rows={3}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              maxLength={2000}
              placeholder="Seat height, grip, a cue to remember…"
              className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => saveNoteMutation.mutate({ exerciseId, notes: noteDraft })}
                disabled={saveNoteMutation.isPending}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-40">
                Save
              </button>
              <button type="button"
                onClick={() => setEditingNote(null)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300">
                Cancel
              </button>
              {/* Clearing is saving an empty string; the API maps that to NULL. */}
              {pref?.notes && (
                <button type="button"
                  onClick={() => saveNoteMutation.mutate({ exerciseId, notes: null })}
                  disabled={saveNoteMutation.isPending}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-40">
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        {/* Deliberately outside the `!collapsed` branch: collapsing the card
            while the confirm is open must not silently drop the prompt. */}
        {confirmDeleteExerciseId === exerciseId && (
          <div
            className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-100 dark:border-red-900"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs text-red-700 dark:text-red-300 flex-1 min-w-0">
              Remove <span className="font-semibold">{exerciseName}</span> and its{' '}
              {sets.length} {sets.length === 1 ? 'set' : 'sets'}?
            </p>
            <button type="button"
              onClick={() => { setConfirmDeleteExerciseId(null); deleteExerciseMutation.mutate(exerciseId); }}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shrink-0">
              Remove
            </button>
            <button type="button"
              onClick={() => setConfirmDeleteExerciseId(null)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 shrink-0">
              Cancel
            </button>
          </div>
        )}

        {!collapsed && (
          <>
            {/* Sets */}
            <div className="px-3 py-1 divide-y divide-gray-50 dark:divide-gray-800">
              {sets.length > 0 && <SetRowHeader units={units} isCardio={isCardio} />}
              {(() => {
                let workingCount = 0;
                return sets.map((set) => {
                  if (!set.isWarmup) workingCount++;
                  // Snapshot: `workingCount` keeps incrementing, so a closure
                  // reading it later would see the final total, not this row's.
                  const roundNumber = workingCount;
                  return (
                    <SetRow key={set.id} set={set} workoutId={id} setIndex={roundNumber} units={units}
                      onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workout', id] })}
                      onSetLogged={() => handleSetLogged(set.exerciseId, roundNumber)}
                      isCardio={isCardio}
                    />
                  );
                });
              })()}
            </div>

            {/* Actions */}
            <div className="px-3 pb-2 flex items-center gap-4 flex-wrap">
              <button type="button" onClick={() => addSetMutation.mutate(exerciseId)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add set
              </button>
              <button type="button" onClick={() => addWarmupMutation.mutate(exerciseId)}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add warmup
              </button>
              <button type="button" onClick={() => addWarmupLadderMutation.mutate(exerciseId)}
                disabled={addWarmupLadderMutation.isPending}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium flex items-center gap-1 disabled:opacity-40">
                <Flame className="h-3 w-3" /> Warmup ladder
              </button>

              {/* Superset / unlink */}
              {groupId ? (
                <button type="button"
                  onClick={() => deleteSupersetMutation.mutate(groupId)}
                  disabled={deleteSupersetMutation.isPending}
                  className="ml-auto text-xs text-orange-500 dark:text-orange-400 hover:text-orange-700 font-medium flex items-center gap-1">
                  <Unlink2 className="h-3 w-3" /> Unlink
                </button>
              ) : (
                <button type="button"
                  onClick={() => setLinkingExerciseId(isLinking ? null : exerciseId)}
                  className={`ml-auto text-xs font-medium flex items-center gap-1 transition-colors ${isLinking ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-indigo-500'}`}>
                  <Link2 className="h-3 w-3" />
                  {isLinking ? 'Cancel' : 'Superset'}
                </button>
              )}
            </div>

            {/* Link picker */}
            {isLinking && otherExerciseIds.length > 0 && (
              <div className="px-3 pb-3 space-y-1.5">
                <p className="text-[11px] font-medium text-gray-500">Pair with:</p>
                <div className="flex flex-wrap gap-1.5">
                  {otherExerciseIds.map((tid) => {
                    const tSets = byExercise.get(tid) ?? [];
                    const tName = tSets[0]?.exercise?.name ?? 'Exercise';
                    return (
                      <button key={tid} type="button"
                        onClick={() => createSupersetMutation.mutate([exerciseId, tid])}
                        disabled={createSupersetMutation.isPending}
                        className="px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors disabled:opacity-40">
                        {tName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI panel */}
            {showAiPanel === exerciseId && (
              <div className="px-3 pb-3">
                <ProgressiveOverloadPanel
                  exerciseId={exerciseId}
                  exerciseName={exerciseName}
                  workoutId={id}
                  units={units}
                  repRangeMin={prefsQuery.data?.[exerciseId]?.repRangeMin}
                  repRangeMax={prefsQuery.data?.[exerciseId]?.repRangeMax}
                  onClose={() => setShowAiPanel(null)}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Duration editor — also the escape hatch for a corrupt saved clock */}
      {showDurationEdit && (
        <DurationEditModal
          workoutId={id}
          currentMin={workout?.durationMin ?? (elapsed > 0 ? Math.round(elapsed / 60) : null)}
          onClose={() => setShowDurationEdit(false)}
          onSaved={(min) => {
            // Re-anchor the local clock to the corrected value so the pill and
            // the stored duration agree.
            const secs = min * 60;
            startAnchorRef.current = Date.now() - secs * 1000;
            setElapsed(secs);
            setClockRunning(false);
            setWorkoutStarted(true);
            saveTimerState(startAnchorRef.current, false, secs);
          }}
        />
      )}

      {/* Rest countdown — opens on set completion, or from the header timer */}
      {showRestTimer && (
        <RestTimerModal
          key={restTimerKey}
          context={restContext ?? undefined}
          onClose={() => setShowRestTimer(false)}
        />
      )}

      {/* Watch reminder — blocking; the clock does not start until acknowledged */}
      {showWatchReminder && (
        <WatchReminderModal
          onConfirm={confirmWatchReminder}
          onDisable={disableWatchReminder}
        />
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <DeleteConfirmModal
          onConfirm={() => { setShowDeleteModal(false); deleteMutation.mutate(); }}
          onCancel={() => setShowDeleteModal(false)}
          isPending={deleteMutation.isPending}
        />
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/workouts" className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{workout.name ?? WORKOUT_TYPE_LABELS[workout.workoutType]}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {parseDateLocal(String(workout.logDate).split('T')[0]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {/* A finished session shows its recorded time, not a live clock:
                  a running pill on a completed workout is what made a finished
                  workout look like one that had never been started. */}
              {isFinished && (
                <>
                  <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3 w-3" />
                    Finished{formatDuration(workout.durationMin) ? ` · ${formatDuration(workout.durationMin)}` : ''}
                  </span>
                </>
              )}

              {!isFinished && workoutStarted && (
                <>
                  <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
                  {/* Always-visible pause/resume pill */}
                  <button
                    type="button"
                    onClick={clockRunning ? pauseClock : resumeClock}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                      clockRunning
                        ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-950/70'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title={clockRunning ? 'Pause clock' : 'Resume clock'}
                  >
                    {clockRunning
                      ? <Pause className="h-3 w-3 fill-indigo-600 dark:fill-indigo-300" />
                      : <Play className="h-3 w-3 fill-gray-600 dark:fill-gray-300" />}
                    <span className="font-mono">{durationDisplay}</span>
                  </button>
                </>
              )}
            </div>
          </div>
          {/* The summary used to be reachable ONLY by finishing — land on it
              once and there was no way back. */}
          <Link href={`/workouts/${id}/summary`}
            className="p-2 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors"
            title="Workout summary" aria-label="Workout summary">
            <BarChart3 className="h-4 w-4" />
          </Link>
          {/* Always available: a workout logged earlier may need its duration
              corrected even though this session never started the clock. */}
          <button type="button" onClick={() => setShowDurationEdit(true)}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Edit duration" aria-label="Edit workout duration">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => openRestTimer()}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Rest timer">
            <Timer className="h-4 w-4" />
          </button>
          {/* Trash can — always visible in header */}
          <button type="button" onClick={() => setShowDeleteModal(true)}
            className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            title="Delete workout">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>


        {/* Start banner — never on a finished session, which is exactly what
            it used to offer: "Start Workout" above a card of completed sets. */}
        {!isFinished && !workoutStarted && (
          <button type="button" onClick={requestStart}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-semibold text-base transition-all shadow-lg shadow-indigo-500/25">
            <Play className="h-5 w-5 fill-white" />
            Start Workout
          </button>
        )}

        {/* Finished banner. The sets stay editable — the pencil and the set
            rows are the repair path for a wrong number, and PRs recompute on
            edit — so this states the status and offers the way out rather
            than locking the page. */}
        {isFinished && (
          <div className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
            <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200 flex-1 min-w-0">
              Workout finished
              {workout.completedAt
                ? ` ${new Date(workout.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </p>
            <button type="button" onClick={() => reopenMutation.mutate()}
              disabled={reopenMutation.isPending}
              className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 disabled:opacity-40 shrink-0">
              Reopen
            </button>
          </div>
        )}

        {/* The exercise is removed from the cache optimistically, so a failure
            puts it back — without this the row would reappear unexplained. */}
        {exerciseActionError && (
          <p className="text-xs text-red-500 px-1">{exerciseActionError}</p>
        )}

        {/* Exercise slots */}
        {slots.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="font-semibold text-gray-700 dark:text-gray-200">No exercises yet</p>
            <p className="text-sm text-gray-500 mt-1">Tap + to add your first exercise</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {slots.map((slot, slotIdx) => {
              // Shared move buttons
              const MoveButtons = () => (
                <div className="flex flex-col" onClick={e => e.stopPropagation()}>
                  <button type="button" disabled={slotIdx === 0 || reorderMutation.isPending}
                    onClick={() => moveSlot(slotIdx, -1, slots)}
                    className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-0 transition-colors">
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button type="button" disabled={slotIdx === slots.length - 1 || reorderMutation.isPending}
                    onClick={() => moveSlot(slotIdx, 1, slots)}
                    className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-0 transition-colors">
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
              );

              if (slot.type === 'single') {
                return (
                  <Card key={slot.exerciseId} className="p-0 overflow-hidden">
                    {renderExerciseCard(slot.exerciseId, false, slot.exerciseId, <MoveButtons />)}
                  </Card>
                );
              }

              // Superset / circuit group
              const color = supersetColor(slot.groupId);
              const label = slot.exerciseIds.length > 2 ? 'Circuit' : 'Superset';
              const groupKey = slot.groupId;
              const groupCollapsed = isKeyCollapsed(groupKey, slot.exerciseIds);
              const groupComplete = isSlotComplete(slot.exerciseIds);
              return (
                <div key={slot.groupId} className="rounded-2xl overflow-hidden border-2"
                  style={{ borderColor: color.border }}>
                  {/* Group header */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                    style={{ backgroundColor: color.border + '18' }}
                    onClick={() => toggleCollapse(groupKey, slot.exerciseIds)}
                  >
                    {groupCollapsed
                      ? <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: color.border }} />
                      : <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: color.border }} />
                    }
                    <Link2 className="h-3 w-3" style={{ color: color.border }} />
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${color.badge}`}>
                      {label}
                    </span>
                    {groupCollapsed ? (
                      groupComplete
                        ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 ml-auto mr-1"><Check className="h-3 w-3" />Done</span>
                        : <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto mr-1">{slot.exerciseIds.length} exercises</span>
                    ) : (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto mr-1">
                        {slot.exerciseIds.length} exercises · alternate with no rest
                      </span>
                    )}
                    <MoveButtons />
                  </div>
                  {/* Exercises within group */}
                  {groupCollapsed ? (
                    <div className="bg-white dark:bg-gray-900 px-3 py-2">
                      <p className="text-xs text-gray-500">
                        {slot.exerciseIds.map(eid => (byExercise.get(eid)?.[0]?.exercise?.name ?? 'Exercise')).join(' → ')}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                      {slot.exerciseIds.map((eid, memberIdx) => renderExerciseCard(
                        eid,
                        true,
                        undefined,
                        // Same control as reordering the slots themselves, but
                        // scoped to the group — a superset's order is the order
                        // you actually alternate in.
                        <div className="flex flex-col" onClick={e => e.stopPropagation()}>
                          <button type="button"
                            disabled={memberIdx === 0 || reorderMutation.isPending}
                            onClick={() => moveInGroup(slot.exerciseIds, memberIdx, -1, exerciseOrder)}
                            className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-0 transition-colors"
                            title="Move up in the superset" aria-label="Move up in the superset">
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button type="button"
                            disabled={memberIdx === slot.exerciseIds.length - 1 || reorderMutation.isPending}
                            onClick={() => moveInGroup(slot.exerciseIds, memberIdx, 1, exerciseOrder)}
                            className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-0 transition-colors"
                            title="Move down in the superset" aria-label="Move down in the superset">
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>,
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add exercise */}
        {showExerciseSearch ? (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">Add Exercise</p>
              <button type="button" onClick={() => setShowExerciseSearch(false)} className="text-xs text-gray-500">Cancel</button>
            </div>
            {addExerciseMutation.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
                <Spinner />
                Adding sets from last time…
              </div>
            ) : (
              <ExerciseSearchForm
                onSelect={(ex) => {
                  setAddExerciseError(null);
                  setSelectedExercise(ex);
                  addExerciseMutation.mutate(ex.id);
                }}
              />
            )}
            {addExerciseError && (
              <p className="mt-2 text-xs text-red-500">{addExerciseError}</p>
            )}
          </Card>
        ) : (
          <button type="button" onClick={() => setShowExerciseSearch(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-all">
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">Add Exercise</span>
          </button>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-end gap-2 pt-2 pb-4">
          {isFinished ? (
            <Link href={`/workouts/${id}/summary`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20">
              <BarChart3 className="h-4 w-4" />
              View Summary
            </Link>
          ) : (
            <button type="button" onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-sm font-semibold transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20">
              <Flag className="h-4 w-4" />
              Finish Workout{workoutStarted ? ` · ${durationDisplay}` : ''}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
