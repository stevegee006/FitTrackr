'use client';

import Link from 'next/link';
import type { Workout } from '@fittrackr/shared';
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import { Card } from '@/components/ui/Card';
import { Clock, Dumbbell } from 'lucide-react';

interface WorkoutCardProps {
  workout: Workout & { sets?: Array<{ exercise?: { primaryMuscle: string } }> };
}

export function WorkoutCard({ workout }: WorkoutCardProps) {
  const color = WORKOUT_TYPE_COLORS[workout.workoutType] ?? '#6b7280';
  const label = WORKOUT_TYPE_LABELS[workout.workoutType];

  const muscles = new Set(
    (workout.sets ?? [])
      .map((s) => s.exercise?.primaryMuscle)
      .filter(Boolean),
  );

  const setCount = (workout.sets ?? []).filter((s: any) => !s.isWarmup).length;

  return (
    <Link href={`/workouts/${workout.id}`}>
      <Card className="flex gap-0 p-0 overflow-hidden hover:shadow-md transition-shadow active:scale-[0.99]">
        <div className="w-1.5 shrink-0 rounded-l-2xl" style={{ backgroundColor: color }} />
        <div className="flex-1 px-3 py-2.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold truncate">
              {workout.name ?? label}
            </p>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{ backgroundColor: color + '20', color }}
            >
              {label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {setCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Dumbbell className="h-3 w-3" />
                {setCount} sets
              </span>
            )}
            {workout.durationMin && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3 w-3" />
                {workout.durationMin}m
              </span>
            )}
          </div>
          {muscles.size > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {[...muscles].slice(0, 4).map((m) => (
                <span
                  key={m}
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: (MUSCLE_GROUP_COLORS as any)[m!] + '20',
                    color: (MUSCLE_GROUP_COLORS as any)[m!],
                  }}
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
