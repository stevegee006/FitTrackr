'use client';

import { useTheme } from '@/providers/ThemeProvider';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS, PRIMARY_MUSCLE_GROUPS } from '@fittrackr/shared';
import type { MuscleGroup } from '@fittrackr/shared';
import { Flame } from 'lucide-react';

export type { MuscleGroup };

interface VolumeRingsProps {
  volumeByMuscle: Partial<Record<MuscleGroup, number>>;
  targetsByMuscle?: Partial<Record<MuscleGroup, number>>;
  onRingTap?: (muscle: MuscleGroup) => void;
  streak?: number;
}

function Ring({
  value,
  max,
  label,
  color,
  size = 68,
  bgStroke,
  onTap,
}: {
  value: number;
  max: number | null;
  label: string;
  color: string;
  size?: number;
  bgStroke: string;
  onTap?: () => void;
}) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max && max > 0 ? Math.min(value / max, 1) : value > 0 ? 1 : 0;
  const offset = circumference * (1 - progress);
  const isOver = max != null && value > max && max > 0;
  const targetHit = max != null && value >= max && max > 0;

  const activeColor = isOver ? '#ef4444' : targetHit ? '#10b981' : color;

  const Wrapper = onTap ? 'button' : 'div';

  return (
    <Wrapper
      {...(onTap ? { type: 'button' as const, onClick: onTap } : {})}
      className={`flex flex-col items-center gap-0.5 min-w-0 ${onTap ? 'cursor-pointer active:scale-95 transition-transform rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500' : ''}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={bgStroke}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={activeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </g>
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={`fill-current font-semibold ${targetHit ? 'text-green-500' : isOver ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}`}
          fontSize={size * 0.2}
        >
          {value}
        </text>
      </svg>
      <div className="text-center min-w-0 w-full">
        <p className="text-[10px] font-medium leading-tight">
          <span className={isOver ? 'text-red-500' : ''}>{value}</span>
          {max != null && <span className="text-gray-400 font-normal">/{max}</span>}
        </p>
        <p className="text-[9px] text-gray-500 leading-tight truncate px-0.5">{label}</p>
      </div>
    </Wrapper>
  );
}

export function VolumeRings({ volumeByMuscle, targetsByMuscle, onRingTap, streak }: VolumeRingsProps) {
  const { isDark } = useTheme();
  const bgStroke = isDark ? '#374151' : '#e5e7eb';

  const topRow = PRIMARY_MUSCLE_GROUPS.slice(0, 5);
  const bottomRow = PRIMARY_MUSCLE_GROUPS.slice(5);

  return (
    <div>
      <div className="space-y-2 py-2">
        <div className="grid grid-cols-5 gap-1">
          {topRow.map((muscle) => (
            <Ring
              key={muscle}
              value={volumeByMuscle[muscle] ?? 0}
              max={targetsByMuscle?.[muscle] ?? null}
              label={MUSCLE_GROUP_LABELS[muscle]}
              color={MUSCLE_GROUP_COLORS[muscle]}
              size={60}
              bgStroke={bgStroke}
              onTap={onRingTap ? () => onRingTap(muscle) : undefined}
            />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {bottomRow.map((muscle) => (
            <Ring
              key={muscle}
              value={volumeByMuscle[muscle] ?? 0}
              max={targetsByMuscle?.[muscle] ?? null}
              label={MUSCLE_GROUP_LABELS[muscle]}
              color={MUSCLE_GROUP_COLORS[muscle]}
              size={60}
              bgStroke={bgStroke}
              onTap={onRingTap ? () => onRingTap(muscle) : undefined}
            />
          ))}
        </div>
      </div>
      {streak != null && streak > 0 && (
        <div className="flex justify-center pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-800/40 px-2.5 py-0.5 text-xs">
            <Flame className="h-3 w-3 text-orange-500" />
            <span className="text-orange-700 dark:text-orange-400 font-medium">{streak} day streak</span>
          </span>
        </div>
      )}
    </div>
  );
}
