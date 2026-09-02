'use client';

import { useTheme } from '@/providers/ThemeProvider';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { MuscleGroup } from '@fittrackr/shared';
import { Flame } from 'lucide-react';
import { earnedBadge, nextBadge } from '@/lib/streak';

export type { MuscleGroup };

interface VolumeRingsProps {
  workoutCount: number;
  weeklyFrequency?: number | null;
  volumeByMuscle: Partial<Record<MuscleGroup, number>>;
  weeklySetTargets?: Partial<Record<MuscleGroup, number>>;
  totalWeightKg?: number;
  units?: 'METRIC' | 'IMPERIAL';
  streak?: number;
  /** Distinct training days so far in the current week. */
  streakDaysThisWeek?: number;
  /** Target training days per week. */
  streakGoal?: number;
}

function Ring({
  value,
  max,
  label,
  color,
  size = 80,
  bgStroke,
  displayValue,
}: {
  value: number;
  max: number | null;
  label: string;
  color: string;
  size?: number;
  bgStroke: string;
  displayValue?: string;
}) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max && max > 0 ? Math.min(value / max, 1) : value > 0 ? 1 : 0;
  const offset = circumference * (1 - progress);
  const isOver = max != null && value > max && max > 0;
  const targetHit = max != null && value >= max && max > 0;
  const activeColor = isOver ? '#ef4444' : targetHit ? '#10b981' : color;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgStroke} strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={activeColor} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" className="transition-all duration-500"
          />
        </g>
        <text
          x={size / 2} y={size / 2 - 4}
          textAnchor="middle" dominantBaseline="central"
          className={`fill-current font-bold ${targetHit ? 'text-green-500' : isOver ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}`}
          fontSize={size * 0.24}
        >
          {displayValue ?? value}
        </text>
        {max != null && (
          <text
            x={size / 2} y={size / 2 + size * 0.18}
            textAnchor="middle" dominantBaseline="central"
            className="fill-current text-gray-400"
            fontSize={size * 0.14}
          >
            /{max}
          </text>
        )}
      </svg>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

function formatWeight(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

export function VolumeRings({
  workoutCount,
  weeklyFrequency,
  volumeByMuscle,
  weeklySetTargets,
  totalWeightKg,
  units = 'METRIC',
  streak,
  streakDaysThisWeek,
  streakGoal,
}: VolumeRingsProps) {
  const { isDark } = useTheme();
  const bgStroke = isDark ? '#374151' : '#e5e7eb';

  const totalSets = Object.values(volumeByMuscle).reduce((s, v) => s + (v ?? 0), 0);
  const totalTarget = weeklySetTargets
    ? Object.values(weeklySetTargets).reduce((s, v) => s + (v ?? 0), 0)
    : null;

  const musclesHit = (Object.entries(volumeByMuscle) as [MuscleGroup, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const weightDisplay = totalWeightKg != null
    ? units === 'IMPERIAL'
      ? Math.round(totalWeightKg * 2.20462)
      : totalWeightKg
    : null;
  const weightLabel = units === 'IMPERIAL' ? 'lbs lifted' : 'kg lifted';

  return (
    <div>
      <div className="flex justify-center gap-6 py-2">
        <Ring
          value={workoutCount}
          max={weeklyFrequency ?? null}
          label="Workouts"
          color="#6366f1"
          size={84}
          bgStroke={bgStroke}
        />
        <Ring
          value={totalSets}
          max={totalTarget && totalTarget > 0 ? totalTarget : null}
          label="Total Sets"
          color="#10b981"
          size={84}
          bgStroke={bgStroke}
        />
        {weightDisplay != null && (
          <Ring
            value={weightDisplay}
            max={null}
            label={weightLabel}
            color="#f59e0b"
            size={84}
            bgStroke={bgStroke}
            displayValue={formatWeight(weightDisplay)}
          />
        )}
      </div>

      {musclesHit.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
          {musclesHit.map(([muscle, count]) => {
            const color = MUSCLE_GROUP_COLORS[muscle];
            return (
              <span
                key={muscle}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: color + '20', color }}
              >
                {MUSCLE_GROUP_LABELS[muscle]}
                <span className="font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Shown even at zero weeks: progress toward this week's goal is the
          useful part, and hiding it entirely on a fresh start is worse. */}
      {(streak != null && streak > 0) || (streakDaysThisWeek != null && streakDaysThisWeek > 0) ? (
        <div className="flex justify-center mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-800/40 px-2.5 py-0.5 text-xs">
            <Flame className="h-3 w-3 text-orange-500" />
            <span className="text-orange-700 dark:text-orange-400 font-medium">
              {streak != null && streak > 0
                ? `${streak} week${streak === 1 ? '' : 's'} at goal`
                : 'This week'}
              {streakGoal != null && streakDaysThisWeek != null && (
                <span className={streak != null && streak > 0 ? 'text-orange-600/70 dark:text-orange-400/70' : ''}>
                  {streak != null && streak > 0 ? ' · ' : ' '}
                  {streakDaysThisWeek}/{streakGoal}
                  {streak != null && streak > 0 ? ' this week' : ' days'}
                </span>
              )}
            </span>
          </span>
        </div>
      ) : null}

      {/* Consistency badge for consecutive weeks at the attendance goal. */}
      {streak != null && streak > 0 && (() => {
        const badge = earnedBadge(streak);
        const next = nextBadge(streak);
        if (!badge && !next) return null;
        return (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            {badge && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.className}`}
                title={`${badge.weeks}+ consecutive weeks at your goal`}
              >
                <span aria-hidden>{badge.emoji}</span>
                {badge.label}
              </span>
            )}
            {next && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {next.weeks - streak} more week{next.weeks - streak === 1 ? '' : 's'} → {next.emoji} {next.label}
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
