'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { addDays, todayString } from '@/lib/utils';
import { TrendingUp, Ruler } from 'lucide-react';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS, PRIMARY_MUSCLE_GROUPS, ALL_MUSCLE_GROUPS } from '@fittrackr/shared';
import type { BodyMeasurement, MuscleGroup } from '@fittrackr/shared';

type TrendsTab = 'training' | 'measurements';

// ─── Shared chart helpers ────────────────────────────────────────

function VolumeBarChart({
  data,
  label,
  color,
  target,
}: {
  data: { date: string; value: number }[];
  label: string;
  color: string;
  target?: number;
}) {
  const maxVal = Math.max(...data.map((d) => d.value), target ?? 0, 1);

  return (
    <Card>
      <p className="text-sm font-semibold mb-4 text-gray-800 dark:text-gray-100">
        {label} — last 7 days
      </p>
      <div className="flex items-end gap-1.5 h-20">
        {data.map((d) => {
          const val = d.value;
          const hasData = val > 0;
          const isOver = hasData && target != null && target > 0 && val >= target;
          const heightPct = hasData ? Math.min((val / maxVal) * 100, 100) : 4;
          const barColor = !hasData
            ? 'bg-gray-200 dark:bg-gray-700'
            : isOver
            ? 'bg-indigo-500 dark:bg-indigo-400'
            : 'bg-indigo-300 dark:bg-indigo-600';

          const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);

          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-gray-400 dark:text-gray-500">
                {hasData ? val : '—'}
              </span>
              <div className="w-full flex items-end" style={{ height: '48px' }}>
                <div
                  className={`w-full rounded-t-sm transition-all ${barColor}`}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="text-[9px] text-gray-500 dark:text-gray-400">{dayLabel}</span>
            </div>
          );
        })}
      </div>
      {target != null && (
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
          Weekly target: {target} sets
        </p>
      )}
    </Card>
  );
}

function LineChart({
  data,
  label,
  color,
  unit,
}: {
  data: { date: string; value: number }[];
  label: string;
  color: string;
  unit: string;
}) {
  if (data.length === 0) {
    return (
      <Card>
        <p className="text-sm font-semibold mb-2 text-gray-800 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">No data yet</p>
      </Card>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const svgW = 400;
  const svgH = 120;
  const pad = { top: 20, right: 16, bottom: 28, left: 16 };
  const plotW = svgW - pad.left - pad.right;
  const plotH = svgH - pad.top - pad.bottom;

  const points = data.map((d, i) => {
    const x = pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = pad.top + plotH - ((d.value - min) / range) * plotH;
    return { x, y, ...d };
  });

  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`;
    if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  const fillD = smoothPath(points) + ` L ${points[points.length - 1].x} ${svgH - pad.bottom} L ${points[0].x} ${svgH - pad.bottom} Z`;
  const gradId = `grad-${label.replace(/\W/g, '')}`;

  const dateLabels: { x: number; text: string }[] = [];
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (points.length >= 1) dateLabels.push({ x: points[0].x, text: fmtDate(data[0].date) });
  if (points.length >= 3) {
    const mid = Math.floor(points.length / 2);
    dateLabels.push({ x: points[mid].x, text: fmtDate(data[mid].date) });
  }
  if (points.length >= 2) dateLabels.push({ x: points[points.length - 1].x, text: fmtDate(data[data.length - 1].date) });

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</p>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Latest: <span className="text-gray-700 dark:text-gray-200">{data[data.length - 1].value.toFixed(1)}{unit}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ height: 120 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#${gradId})`} />
        <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#030712" stroke={color} strokeWidth="2" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize="9" fontWeight="500">
              {p.value.toFixed(1)}
            </text>
          </g>
        ))}
        {dateLabels.map((dl, i) => (
          <text
            key={i}
            x={dl.x}
            y={svgH - 6}
            textAnchor={i === 0 ? 'start' : i === dateLabels.length - 1 ? 'end' : 'middle'}
            className="fill-gray-400 dark:fill-gray-500"
            fontSize="9"
          >
            {dl.text}
          </text>
        ))}
      </svg>
    </Card>
  );
}

// ─── Main page ───────────────────────────────────────────────────

const KG_PER_LB = 0.453592;
const LB_PER_KG = 2.20462;
const IN_PER_CM = 1 / 2.54;

export default function TrendsPage() {
  const [tab, setTab] = useState<TrendsTab>('training');
  const today = todayString();
  const weekStart = addDays(today, -((new Date().getDay() + 6) % 7));
  const weekEnd = addDays(weekStart, 6);
  const prevWeekStart = addDays(weekStart, -7);
  const prevWeekEnd = addDays(weekStart, -1);
  const thirtyDaysAgo = addDays(today, -29);

  type VolumeResponse = { data: { volumeByMuscle: Record<string, number>; totalWeightKg: number } };

  // This week's volume per muscle group
  const { data: volumeThis, isLoading: volThisLoading } = useQuery({
    queryKey: ['workout-volume', weekStart, weekEnd],
    queryFn: () => apiFetch<VolumeResponse>(`/workouts/volume?from=${weekStart}&to=${weekEnd}`),
  });

  // Last week's volume for comparison
  const { data: volumePrev, isLoading: volPrevLoading } = useQuery({
    queryKey: ['workout-volume', prevWeekStart, prevWeekEnd],
    queryFn: () => apiFetch<VolumeResponse>(`/workouts/volume?from=${prevWeekStart}&to=${prevWeekEnd}`),
  });

  // Active training goal for targets
  const { data: goalData } = useQuery({
    queryKey: ['training-goal-active'],
    queryFn: () => apiFetch<{ data: any }>('/training-goals/active'),
  });

  // This week workout count
  const { data: workoutsThisWeek, isLoading: workoutsLoading } = useQuery({
    queryKey: ['workouts', weekStart, weekEnd],
    queryFn: () =>
      apiFetch<{ data: any[] }>(`/workouts?from=${weekStart}&to=${weekEnd}&limit=20`),
  });

  // Measurement data (last 30 days)
  const { data: measureRes, isLoading: measureLoading } = useQuery({
    queryKey: ['measurements-range', thirtyDaysAgo, today],
    queryFn: () =>
      apiFetch<{ data: BodyMeasurement[] }>(
        `/measurements/range?from=${thirtyDaysAgo}&to=${today}`,
      ),
    enabled: tab === 'measurements',
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });

  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const isLoading = volThisLoading || volPrevLoading || workoutsLoading || (tab === 'measurements' && measureLoading);

  const thisVol = (volumeThis?.data?.volumeByMuscle ?? {}) as Record<string, number>;
  const prevVol = (volumePrev?.data?.volumeByMuscle ?? {}) as Record<string, number>;
  const weeklySetTargets = (goalData?.data?.volumeTargets as any)?.weeklySetTargets as Record<string, number> | undefined;
  const workoutsCount = workoutsThisWeek?.data?.length ?? 0;

  const totalSetsThis = Object.values(thisVol).reduce((a, b) => a + b, 0);
  const totalSetsPrev = Object.values(prevVol).reduce((a, b) => a + b, 0);
  const setsChange = totalSetsThis - totalSetsPrev;

  // The always-shown rows, plus anything actually trained this week or carrying
  // a target. Curating PRIMARY_MUSCLE_GROUPS by hand meant a muscle group could
  // be trained all week and simply not appear on this chart — which is how
  // calves went missing. Ordered canonically so rows don't jump week to week.
  const chartMuscles = ALL_MUSCLE_GROUPS.filter(
    (m) =>
      PRIMARY_MUSCLE_GROUPS.includes(m) ||
      (thisVol[m] ?? 0) > 0 ||
      (weeklySetTargets?.[m] ?? 0) > 0,
  );

  // ── Measurement calculations ──
  const measurements = measureRes?.data ?? [];

  function extractSeries(key: keyof BodyMeasurement, convertFn?: (v: number) => number) {
    return measurements
      .filter((m) => m[key] != null)
      .map((m) => {
        const raw = m[key] as number;
        const dateStr = typeof m.measuredAt === 'string' ? m.measuredAt.slice(0, 10) : new Date(m.measuredAt).toISOString().slice(0, 10);
        return { date: dateStr, value: convertFn ? convertFn(raw) : raw };
      });
  }

  const toIn = isImperial ? (v: number) => Math.round(v * IN_PER_CM * 10) / 10 : undefined;
  const toLbs = isImperial ? (v: number) => Math.round(v * LB_PER_KG * 10) / 10 : undefined;
  const lenUnit = isImperial ? 'in' : 'cm';
  const wtUnit = isImperial ? 'lbs' : 'kg';

  const weightData = extractSeries('weightKg', toLbs);
  const bfData = extractSeries('bodyFatPct');
  const leanData = extractSeries('leanMassKg', toLbs);
  const waistData = extractSeries('waist', toIn);
  const hipData = extractSeries('hip', toIn);
  const chestData = extractSeries('chest', toIn);
  const abdomenData = extractSeries('abdomen', toIn);
  const neckData = extractSeries('neck', toIn);
  const shoulderData = extractSeries('shoulder', toIn);
  const thighRData = extractSeries('thighR', toIn);
  const thighLData = extractSeries('thighL', toIn);
  const bicepRData = extractSeries('bicepR', toIn);
  const bicepLData = extractSeries('bicepL', toIn);
  const calfRData = extractSeries('calfR', toIn);
  const calfLData = extractSeries('calfL', toIn);

  const latestWeight = weightData.length > 0 ? weightData[weightData.length - 1].value : null;
  const firstWeight = weightData.length > 0 ? weightData[0].value : null;
  const weightChange = latestWeight != null && firstWeight != null && weightData.length > 1 ? latestWeight - firstWeight : null;
  const latestBf = bfData.length > 0 ? bfData[bfData.length - 1].value : null;

  const circumCharts = [
    { data: waistData, label: `Waist (${lenUnit})`, color: '#3b82f6', unit: lenUnit },
    { data: hipData, label: `Hip (${lenUnit})`, color: '#a855f7', unit: lenUnit },
    { data: chestData, label: `Chest (${lenUnit})`, color: '#ef4444', unit: lenUnit },
    { data: abdomenData, label: `Abdomen (${lenUnit})`, color: '#f97316', unit: lenUnit },
    { data: neckData, label: `Neck (${lenUnit})`, color: '#06b6d4', unit: lenUnit },
    { data: shoulderData, label: `Shoulder (${lenUnit})`, color: '#8b5cf6', unit: lenUnit },
    { data: thighRData, label: `Thigh R (${lenUnit})`, color: '#ec4899', unit: lenUnit },
    { data: thighLData, label: `Thigh L (${lenUnit})`, color: '#f43f5e', unit: lenUnit },
    { data: bicepRData, label: `Bicep R (${lenUnit})`, color: '#14b8a6', unit: lenUnit },
    { data: bicepLData, label: `Bicep L (${lenUnit})`, color: '#0d9488', unit: lenUnit },
    { data: calfRData, label: `Calf R (${lenUnit})`, color: '#64748b', unit: lenUnit },
    { data: calfLData, label: `Calf L (${lenUnit})`, color: '#475569', unit: lenUnit },
  ].filter((c) => c.data.length > 0);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
          TRENDS
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Trends</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track your progress over time</p>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1" data-tutorial="trends-tabs">
        {([
          { key: 'training' as const, label: 'Training', icon: TrendingUp },
          { key: 'measurements' as const, label: 'Body', icon: Ruler },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 px-3 text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Training tab ── */}
      {tab === 'training' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Total sets</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{totalSetsThis}</p>
              <p className={`text-[10px] mt-0.5 ${setsChange >= 0 ? 'text-indigo-500' : 'text-gray-400'}`}>
                {totalSetsPrev > 0
                  ? `${setsChange >= 0 ? '+' : ''}${setsChange} vs last week`
                  : 'This week'}
              </p>
            </Card>
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Workouts</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{workoutsCount}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">this week</p>
            </Card>
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Muscles hit</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {Object.keys(thisVol).filter((m) => (thisVol[m] ?? 0) > 0).length}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">this week</p>
            </Card>
          </div>

          {/* Volume by muscle group */}
          <Card>
            <p className="text-sm font-semibold mb-4">Volume by Muscle Group</p>
            <div className="space-y-2">
              {chartMuscles.map((muscle) => {
                const sets = thisVol[muscle] ?? 0;
                const target = weeklySetTargets?.[muscle];
                const maxSets = Math.max(...chartMuscles.map((m) => thisVol[m] ?? 0), target ?? 0, 1);
                const pct = sets > 0 ? Math.min((sets / maxSets) * 100, 100) : 0;
                const color = MUSCLE_GROUP_COLORS[muscle];
                return (
                  <div key={muscle} className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs w-20 shrink-0">{MUSCLE_GROUP_LABELS[muscle]}</span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 shrink-0 w-20 text-right">
                      {sets} sets{target ? `/${target}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Measurements tab ── */}
      {tab === 'measurements' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Current weight</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {latestWeight != null ? `${latestWeight.toFixed(1)}` : '—'}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {latestWeight != null ? (isImperial ? 'lbs' : 'kg') : 'No data'}
              </p>
            </Card>
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">30d change</p>
              <p className={`text-lg font-bold ${weightChange != null ? (weightChange <= 0 ? 'text-indigo-500' : 'text-red-400') : 'text-gray-900 dark:text-gray-100'}`}>
                {weightChange != null ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)}` : '—'}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {weightChange != null ? (isImperial ? 'lbs' : 'kg') : 'No data'}
              </p>
            </Card>
            <Card className="py-3 px-3">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Body fat</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {latestBf != null ? `${latestBf.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {latestBf != null ? 'Latest' : 'No data'}
              </p>
            </Card>
          </div>

          <LineChart data={weightData} label={`Weight (${wtUnit})`} color="#6366f1" unit={wtUnit} />
          <LineChart data={bfData} label="Body Fat (%)" color="#f59e0b" unit="%" />
          <LineChart data={leanData} label={`Lean Mass (${wtUnit})`} color="#06b6d4" unit={wtUnit} />

          {circumCharts.length > 0 && (
            <>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Measurements</p>
              {circumCharts.map((c) => (
                <LineChart key={c.label} data={c.data} label={c.label} color={c.color} unit={c.unit} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
