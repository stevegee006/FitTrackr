'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { SetRow } from '@/components/workout/SetRow';
import { RestTimer } from '@/components/workout/RestTimer';
import { ExerciseSearchForm } from '@/components/exercise/ExerciseSearchForm';
import { ProgressiveOverloadPanel } from '@/components/workout/ProgressiveOverloadPanel';
import { WORKOUT_TYPE_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Workout, WorkoutSet, Exercise } from '@fittrackr/shared';
import { useAuth } from '@/providers/AuthProvider';
import { parseDateLocal } from '@/lib/utils';
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, Timer, Sparkles, Check, X, Flame, Pause, Play, Flag, Link2, Unlink2, ArrowUp, ArrowDown, Watch } from 'lucide-react';
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
// Nudge to start a watch/tracker alongside the workout. Deliberately a
// non-blocking banner rather than a modal — the logging flow is used one-handed
// mid-set, so it must never require a tap to proceed.

const WATCH_REMINDER_KEY = 'fittrackr_watch_reminder';
const WATCH_REMINDER_MS = 12_000;

function watchReminderEnabled(): boolean {
  try {
    return localStorage.getItem(WATCH_REMINDER_KEY) !== 'off';
  } catch {
    return true;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showExerciseSearch, setShowExerciseSearch] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restTimerTrigger, setRestTimerTrigger] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [clockRunning, setClockRunning] = useState(false);
  const [workoutStarted, setWorkoutStarted] = useState(false);
  const [showWatchReminder, setShowWatchReminder] = useState(false);
  const startAnchorRef = useRef<number>(0);
  const watchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the auto-dismiss timer if the page unmounts while it's pending.
  useEffect(() => () => {
    if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
  }, []);

  function dismissWatchReminder(permanently = false) {
    if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
    setShowWatchReminder(false);
    if (permanently) {
      try { localStorage.setItem(WATCH_REMINDER_KEY, 'off'); } catch { /* ignore */ }
    }
  }

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

  // Restore timer on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(timerKey);
      if (!raw) return;
      const { anchor, isRunning, pausedElapsed } = JSON.parse(raw) as { anchor: number; isRunning: boolean; pausedElapsed: number };
      setWorkoutStarted(true);
      if (isRunning) {
        startAnchorRef.current = anchor;
        setElapsed(Math.floor((Date.now() - anchor) / 1000));
        setClockRunning(true);
      } else {
        setElapsed(pausedElapsed);
        setClockRunning(false);
      }
    } catch { /* corrupt data — ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [editingRepRange, setEditingRepRange] = useState<Map<string, boolean>>(new Map());
  const [repRangeEdits, setRepRangeEdits] = useState<Record<string, { min: string; max: string }>>({});
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
          apiFetch<{ data: { repRangeMin: number | null; repRangeMax: number | null; targetSets: number | null } | null }>(
            `/exercises/${eid}/preference`
          ).then(r => [eid, r.data] as const)
        )
      );
      return Object.fromEntries(results) as Record<string, { repRangeMin: number | null; repRangeMax: number | null; targetSets: number | null } | null>;
    },
    enabled: exerciseIds.length > 0,
  });

  const workout = data?.data;

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

  const finishMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/workouts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ durationMin: Math.max(1, Math.round(elapsed / 60)) }),
      }),
    onSuccess: () => {
      clearTimerState();
      pauseClock();
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['workout-volume'] });
      router.replace('/workouts');
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
    // Only on a fresh start — not on resume, which isn't "starting a workout".
    if (watchReminderEnabled()) {
      setShowWatchReminder(true);
      if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
      watchTimeoutRef.current = setTimeout(() => setShowWatchReminder(false), WATCH_REMINDER_MS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

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

  useEffect(() => {
    if (!workout?.sets?.length) return;
    setCardioExercises(prev => {
      const next = new Set(prev);
      for (const s of workout.sets!) {
        if ((s as any).durationSec != null || (s as any).distanceM != null) next.add(s.exerciseId);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout?.id]);

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

  function handleSetLogged() {
    setShowRestTimer(true);
    setRestTimerTrigger((t) => t + 1);
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
      const groupEids = (supersetGroupMap.get(gid) ?? [eid]).filter(e => byExercise.has(e));
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
        {/* Exercise header */}
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 ${collapseKey ? 'cursor-pointer' : ''}`}
          style={{ borderLeftColor: (MUSCLE_GROUP_COLORS as any)[primaryMuscle], borderLeftWidth: 3 }}
          onClick={collapseKey ? () => toggleCollapse(collapseKey, [exerciseId]) : undefined}
        >
          {collapseKey && (
            collapsed
              ? <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              : <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          )}

          <p className="text-sm font-semibold flex-1">{exerciseName}</p>

          {collapsed && (
            workingSetsDone === workingSetsTotal && workingSetsTotal > 0
              ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="h-3 w-3" />Done</span>
              : <span className="text-xs text-gray-400">{workingSetsDone}/{workingSetsTotal}</span>
          )}

          {!collapsed && (
            <>
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
                  className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
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
                  setCardioExercises(prev => {
                    const n = new Set(prev);
                    n.has(exerciseId) ? n.delete(exerciseId) : n.add(exerciseId);
                    return n;
                  });
                }}
                className={`p-1 rounded-lg transition-colors ${isCardio ? 'text-sky-600 bg-sky-100 dark:bg-sky-900/40' : 'text-gray-400 hover:text-sky-500'}`}
                title={isCardio ? 'Switch to strength mode' : 'Switch to cardio mode'}>
                <Timer className="h-3.5 w-3.5" />
              </button>

              <span className="text-xs text-gray-500">{workingSets.length} sets</span>
              {moveButtons && <div onClick={e => e.stopPropagation()}>{moveButtons}</div>}
            </>
          )}
        </div>

        {!collapsed && (
          <>
            {/* Sets */}
            <div className="px-3 py-1 divide-y divide-gray-50 dark:divide-gray-800">
              {(() => {
                let workingCount = 0;
                return sets.map((set) => {
                  if (!set.isWarmup) workingCount++;
                  return (
                    <SetRow key={set.id} set={set} workoutId={id} setIndex={workingCount} units={units}
                      onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workout', id] })}
                      onSetLogged={handleSetLogged}
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
              {workoutStarted && (
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
          <button type="button" onClick={() => setShowRestTimer((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${showRestTimer ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
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

        {showRestTimer && (
          <Card>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Rest Timer</p>
            <RestTimer triggerStart={restTimerTrigger} />
          </Card>
        )}

        {/* Start banner */}
        {!workoutStarted && (
          <button type="button" onClick={startClock}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-semibold text-base transition-all shadow-lg shadow-indigo-500/25">
            <Play className="h-5 w-5 fill-white" />
            Start Workout
          </button>
        )}

        {/* Watch reminder — non-blocking, auto-dismisses */}
        {showWatchReminder && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          >
            <Watch className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Start your watch
              </p>
              <button
                type="button"
                onClick={() => dismissWatchReminder(true)}
                className="text-xs text-amber-700/80 dark:text-amber-400/80 hover:underline"
              >
                Don&apos;t remind me again
              </button>
            </div>
            <button
              type="button"
              onClick={() => dismissWatchReminder()}
              className="shrink-0 p-1.5 rounded-lg text-amber-600/70 dark:text-amber-400/70 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
              aria-label="Dismiss reminder"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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
                      {slot.exerciseIds.map((eid) => renderExerciseCard(eid, true))}
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
            <ExerciseSearchForm
              onSelect={(ex) => {
                setSelectedExercise(ex);
                addSetMutation.mutate(ex.id);
              }}
            />
          </Card>
        ) : (
          <button type="button" onClick={() => setShowExerciseSearch(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-all">
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">Add Exercise</span>
          </button>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-end pt-2 pb-4">
          <button type="button" onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-sm font-semibold transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20">
            <Flag className="h-4 w-4" />
            Finish Workout{workoutStarted ? ` · ${durationDisplay}` : ''}
          </button>
        </div>
      </div>
    </>
  );
}
