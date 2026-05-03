'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { WorkoutCard } from '@/components/workout/WorkoutCard';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import type { Workout, WorkoutType } from '@fittrackr/shared';
import { todayString, addDays } from '@/lib/utils';
import Link from 'next/link';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

export default function WorkoutsPage() {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const today = todayString();
  const weekStart = addDays(today, -((new Date().getDay() + 6) % 7) + weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);

  const { data, isLoading } = useQuery({
    queryKey: ['workouts', weekStart, weekEnd],
    queryFn: () =>
      apiFetch<{ data: Workout[]; meta: any }>(`/workouts?from=${weekStart}&to=${weekEnd}&limit=50`),
  });

  const createMutation = useMutation({
    mutationFn: (workoutType: WorkoutType) =>
      apiFetch<{ data: Workout }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ logDate: today, workoutType, name: WORKOUT_TYPE_LABELS[workoutType] }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      window.location.href = `/workouts/${res.data.id}`;
    },
  });

  const workouts = data?.data ?? [];

  const weekLabel = weekOffset === 0
    ? 'This Week'
    : weekOffset === -1
    ? 'Last Week'
    : `Week of ${new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workouts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track your training sessions</p>
        </div>
      </div>

      {/* Quick start */}
      <Card>
        <p className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Start a workout</p>
        <div className="grid grid-cols-4 gap-2">
          {(['PUSH', 'PULL', 'LEGS', 'FULL_BODY'] as WorkoutType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => createMutation.mutate(type)}
              disabled={createMutation.isPending}
              className="flex flex-col items-center gap-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 transition-all active:scale-95"
            >
              <span className="text-lg">
                {type === 'PUSH' ? '🤜' : type === 'PULL' ? '🤛' : type === 'LEGS' ? '🦵' : '💪'}
              </span>
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{WORKOUT_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          {(['UPPER', 'LOWER', 'CARDIO', 'CUSTOM'] as WorkoutType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => createMutation.mutate(type)}
              disabled={createMutation.isPending}
              className="flex-1 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-all active:scale-95"
            >
              {WORKOUT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </Card>

      {/* Week navigation */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold">{weekLabel}</h2>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => Math.min(w + 1, 0))}
            disabled={weekOffset === 0}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : workouts.length === 0 ? (
          <Card className="py-10 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50">
              <span className="text-2xl">💪</span>
            </div>
            <p className="font-semibold text-gray-700 dark:text-gray-200">No workouts this week</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Start one above to begin logging</p>
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
