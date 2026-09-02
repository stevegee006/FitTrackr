'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { todayString, addDays } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { VolumeRings } from '@/components/volume/VolumeRings';
import { WorkoutCard } from '@/components/workout/WorkoutCard';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Plus, Sparkles } from 'lucide-react';
import type { Workout, UserProfile, TrainingGoal, MuscleGroup, WorkoutType } from '@fittrackr/shared';
import { MUSCLE_GROUP_LABELS, WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import Link from 'next/link';

function getSmartGreeting(
  profile: UserProfile | undefined,
  streak: number,
  daysSinceWorkout: number | null,
  undertrainedMuscles: MuscleGroup[],
): { emoji: string; message: string } {
  const hour = new Date().getHours();

  // Birthday check
  if (profile?.birthDate) {
    const bd = profile.birthDate.slice(5, 10);
    const todayMD = new Date().toISOString().slice(5, 10);
    if (bd === todayMD) {
      return { emoji: '🎂', message: 'Happy Birthday! Take a rest day — you deserve it!' };
    }
  }

  // Streak milestones
  if (streak >= 30) {
    return { emoji: '🔥', message: `${streak}-day workout streak! You’re an absolute machine.` };
  }
  if (streak >= 14) {
    return { emoji: '🚀', message: `${streak} days in a row! Incredible consistency.` };
  }
  if (streak >= 7) {
    return { emoji: '⭐', message: `${streak}-day streak! A full week of training — keep it up!` };
  }
  if (streak >= 3) {
    return { emoji: '💪', message: `${streak}-day streak! You’re building a great habit.` };
  }

  // Days since last workout feedback
  if (daysSinceWorkout === 0) {
    return { emoji: '🔥', message: "You trained today — great work!" };
  }
  if (daysSinceWorkout === 1) {
    return { emoji: '💪', message: "Yesterday’s session is in the books. Ready for today?" };
  }
  if (daysSinceWorkout !== null && daysSinceWorkout >= 4) {
    return { emoji: '⏰', message: `It’s been ${daysSinceWorkout} days since your last workout — time to get back at it!` };
  }

  // Undertrained muscle nudge
  if (undertrainedMuscles.length > 0) {
    const names = undertrainedMuscles
      .slice(0, 2)
      .map((m) => MUSCLE_GROUP_LABELS[m])
      .join(' & ');
    return { emoji: '🎯', message: `${names} could use some love this week.` };
  }

  // Time-of-day defaults
  if (hour < 12) {
    return { emoji: '☀️', message: "Good morning! Let’s make today count." };
  }
  if (hour < 17) {
    return { emoji: '👋', message: "Here’s your training overview" };
  }
  return { emoji: '🌙', message: "Good evening! How’s the training going?" };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const today = todayString();

  // Week bounds (Mon–Sun)
  const weekStart = addDays(today, -((new Date().getDay() + 6) % 7));
  const weekEnd = addDays(weekStart, 6);

  const { data: volumeData, isLoading: volumeLoading } = useQuery({
    queryKey: ['workout-volume', weekStart, weekEnd],
    queryFn: () =>
      apiFetch<{ data: { volumeByMuscle: Record<string, number>; totalWeightKg: number } }>(
        `/workouts/volume?from=${weekStart}&to=${weekEnd}`
      ),
  });

  const { data: goalData } = useQuery({
    queryKey: ['training-goal-active'],
    queryFn: () => apiFetch<{ data: TrainingGoal | null }>('/training-goals/active'),
  });

  const createWorkoutMutation = useMutation({
    mutationFn: (workoutType: WorkoutType) =>
      apiFetch<{ data: Workout }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ logDate: today, workoutType, name: WORKOUT_TYPE_LABELS[workoutType] }),
      }),
    onSuccess: (res) => {
      window.location.href = `/workouts/${res.data.id}`;
    },
  });

  // This week's workouts
  const { data: workoutsData, isLoading: workoutsLoading } = useQuery({
    queryKey: ['workouts', weekStart, weekEnd],
    queryFn: () =>
      apiFetch<{ data: Workout[] }>(`/workouts?from=${weekStart}&to=${weekEnd}&limit=20`),
  });

  // Last 30 days for streak
  const thirtyDaysAgo = addDays(today, -30);
  const { data: rangeData } = useQuery({
    queryKey: ['workouts-range', thirtyDaysAgo, today],
    queryFn: () =>
      apiFetch<{ data: { logDate: string }[] }>(`/workouts/range?from=${thirtyDaysAgo}&to=${today}`),
  });

  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<{ data: UserProfile }>('/users/me/profile'),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: 'METRIC' | 'IMPERIAL' } }>('/users/me/settings'),
  });

  if (volumeLoading || workoutsLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  const volumeByMuscle = (volumeData?.data?.volumeByMuscle ?? {}) as Partial<Record<MuscleGroup, number>>;
  const weeklySetTargets = (goalData?.data?.volumeTargets as any)?.weeklySetTargets as
    | Partial<Record<MuscleGroup, number>>
    | undefined;
  const workouts = workoutsData?.data ?? [];

  // Streak: consecutive days with a workout, ending today
  const workoutDates = new Set(
    (rangeData?.data ?? []).map((d) => d.logDate.split('T')[0]),
  );
  let streak = 0;
  for (let i = 0; i <= 30; i++) {
    if (workoutDates.has(addDays(today, -i))) {
      streak++;
    } else {
      break;
    }
  }

  // Days since last workout
  let daysSinceWorkout: number | null = null;
  for (let i = 0; i <= 30; i++) {
    if (workoutDates.has(addDays(today, -i))) {
      daysSinceWorkout = i;
      break;
    }
  }

  // Undertrained: muscles with < 50% of weekly target
  const undertrainedMuscles: MuscleGroup[] = weeklySetTargets
    ? (Object.entries(weeklySetTargets) as [MuscleGroup, number][])
        .filter(([m, target]) => target > 0 && (volumeByMuscle[m] ?? 0) < target * 0.5)
        .map(([m]) => m)
    : [];

  const greeting = getSmartGreeting(profileData?.data, streak, daysSinceWorkout, undertrainedMuscles);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            Hi, {user?.displayName?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {greeting.emoji} {greeting.message}
          </p>
        </div>
        <Link
          href="/coach"
          data-tutorial="ai-coach"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 hover:bg-indigo-700 active:scale-[0.98] transition-all"
        >
          <Sparkles className="h-4 w-4" />
          AI Coach
        </Link>
      </div>

      {/* Volume rings */}
      <Card
        className="relative overflow-hidden border-indigo-200/50 dark:border-indigo-800/30 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-900/50"
        data-tutorial="volume-rings"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-indigo-500/5 dark:bg-indigo-400/5 blur-2xl" />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          This week&apos;s volume
        </p>
        <VolumeRings
          workoutCount={workouts.length}
          weeklyFrequency={goalData?.data?.weeklyFrequency}
          volumeByMuscle={volumeByMuscle}
          weeklySetTargets={weeklySetTargets}
          totalWeightKg={volumeData?.data?.totalWeightKg}
          units={settingsData?.data?.preferredUnits}
          streak={streak}
        />
      </Card>

      {/* Quick start */}
      <Card className="p-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Quick Start</p>
        <div className="grid grid-cols-4 gap-2">
          {(['PUSH', 'PULL', 'LEGS', 'FULL_BODY'] as WorkoutType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => createWorkoutMutation.mutate(type)}
              disabled={createWorkoutMutation.isPending}
              className="flex flex-col items-center gap-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 transition-all active:scale-95"
            >
              <span className="text-xl">{type === 'PUSH' ? '🤜' : type === 'PULL' ? '🤛' : type === 'LEGS' ? '🦵' : '💪'}</span>
              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 text-center leading-tight">{WORKOUT_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          {(['UPPER', 'LOWER', 'CARDIO', 'CUSTOM'] as WorkoutType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => createWorkoutMutation.mutate(type)}
              disabled={createWorkoutMutation.isPending}
              className="flex-1 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 text-[10px] font-medium text-gray-600 dark:text-gray-300 transition-all active:scale-95"
            >
              {WORKOUT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </Card>

      {/* This week's workouts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">This Week</h2>
          <Link
            href="/workouts"
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            See all
          </Link>
        </div>

        {workouts.length === 0 ? (
          <Card className="py-10 text-center" data-tutorial="start-workout">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50">
              <span className="text-2xl">💪</span>
            </div>
            <p className="font-semibold text-gray-700 dark:text-gray-200">No workouts yet this week</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Start a session to begin logging</p>
            <Link
              href="/workouts"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 transition-all"
            >
              <Plus className="h-4 w-4" />
              Start a Workout
            </Link>
          </Card>
        ) : (
          <div className="space-y-2">
            {workouts.map((w) => (
              <WorkoutCard key={w.id} workout={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
