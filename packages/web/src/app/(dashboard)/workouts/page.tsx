'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from '@fittrackr/shared';
import type { Workout, WorkoutType } from '@fittrackr/shared';
import { todayString, parseDateLocal, formatDate } from '@/lib/utils';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Dumbbell, Clock } from 'lucide-react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonthBounds(year: number, month: number): { firstDay: string; lastDay: string } {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return {
    firstDay: formatDate(first),
    lastDay: formatDate(last),
  };
}

/** Returns Mon-anchored day-of-week index (0=Mon, 6=Sun) */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export default function WorkoutsPage() {
  const queryClient = useQueryClient();
  const today = todayString();
  const todayDate = parseDateLocal(today);

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(today);

  const viewYear = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1).getFullYear();
  const viewMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1).getMonth();

  const { firstDay, lastDay } = getMonthBounds(viewYear, viewMonth);

  const { data, isLoading } = useQuery({
    queryKey: ['workouts', firstDay, lastDay],
    queryFn: () =>
      apiFetch<{ data: Workout[] }>(`/workouts?from=${firstDay}&to=${lastDay}&limit=100`),
  });

  const createMutation = useMutation({
    mutationFn: ({ workoutType, logDate }: { workoutType: WorkoutType; logDate: string }) =>
      apiFetch<{ data: Workout }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ logDate, workoutType, name: WORKOUT_TYPE_LABELS[workoutType] }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      window.location.href = `/workouts/${res.data.id}`;
    },
  });

  const workouts = data?.data ?? [];

  // Map date string → workouts
  const byDate = new Map<string, Workout[]>();
  for (const w of workouts) {
    const d = String(w.logDate).split('T')[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(w);
  }

  // Build calendar grid: pad with nulls so Mon is col 0
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startPad = mondayIndex(firstOfMonth);
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const selectedWorkouts = byDate.get(selectedDate) ?? [];
  const selectedDateObj = parseDateLocal(selectedDate);
  const selectedLabel = selectedDateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = selectedDate === today;
  const isFuture = selectedDate > today;

  function handleDayClick(day: number) {
    const d = formatDate(new Date(viewYear, viewMonth, day));
    setSelectedDate(d);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workouts</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track your training sessions</p>
      </div>

      {/* Calendar */}
      <Card className="p-3">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setMonthOffset((m) => m - 1)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setMonthOffset((m) => Math.min(m + 1, 0))}
            disabled={monthOffset === 0}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="h-11" />;
              }
              const dateStr = formatDate(new Date(viewYear, viewMonth, day));
              const dayWorkouts = byDate.get(dateStr) ?? [];
              const isSelected = dateStr === selectedDate;
              const isTodayCell = dateStr === today;

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`relative h-11 rounded-lg flex flex-col items-center justify-start pt-1 transition-all ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : isTodayCell
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span className={`text-xs leading-none ${isTodayCell && !isSelected ? 'font-bold' : ''}`}>
                    {day}
                  </span>
                  {dayWorkouts.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center px-0.5">
                      {dayWorkouts.slice(0, 3).map((w) => (
                        <div
                          key={w.id}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: isSelected ? 'white' : (WORKOUT_TYPE_COLORS[w.workoutType] ?? '#6b7280') }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Selected day panel */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{selectedLabel}</p>
          {isToday && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              Today
            </span>
          )}
        </div>

        {selectedWorkouts.length > 0 ? (
          <div className="space-y-2">
            {selectedWorkouts.map((w) => {
              const color = WORKOUT_TYPE_COLORS[w.workoutType] ?? '#6b7280';
              const setCount = (w.sets ?? []).filter((s: any) => !s.isWarmup).length;
              return (
                <Link key={w.id} href={`/workouts/${w.id}`}>
                  <Card className="flex gap-0 p-0 overflow-hidden hover:shadow-md transition-shadow active:scale-[0.99]">
                    <div className="w-1.5 shrink-0 rounded-l-2xl" style={{ backgroundColor: color }} />
                    <div className="flex-1 px-3 py-2.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate">{w.name ?? WORKOUT_TYPE_LABELS[w.workoutType]}</p>
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: color + '20', color }}
                        >
                          {WORKOUT_TYPE_LABELS[w.workoutType]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {setCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Dumbbell className="h-3 w-3" />
                            {setCount} sets
                          </span>
                        )}
                        {w.durationMin && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            {w.durationMin}m
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card className="py-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isFuture ? 'No workout planned' : 'No workout logged'}
            </p>
          </Card>
        )}

        {/* Add workout for selected date */}
        {!isFuture && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {selectedWorkouts.length > 0 ? 'Add another workout' : 'Start a workout'}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(['PUSH', 'PULL', 'LEGS', 'FULL_BODY'] as WorkoutType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => createMutation.mutate({ workoutType: type, logDate: selectedDate })}
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
                  onClick={() => createMutation.mutate({ workoutType: type, logDate: selectedDate })}
                  disabled={createMutation.isPending}
                  className="flex-1 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-all active:scale-95"
                >
                  {WORKOUT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
