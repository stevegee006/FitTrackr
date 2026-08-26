'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface PlateConfig {
  // perSide=false means the load is stacked on ONE side (sled, some machines),
  // so the target isn't halved. Absent means true — a normal barbell.
  bars: Array<{ name: string; weightKg: number; perSide?: boolean }>;
  defaultBarIndex: number;
  platesKg: number[];
  platesLbs: number[];
}

/** Absent perSide is a barbell — keeps configs saved before sleds existed working. */
function isPerSide(bar: { perSide?: boolean }): boolean {
  return bar.perSide !== false;
}

const DEFAULT_PLATE_CONFIG: PlateConfig = {
  bars: [
    { name: 'Standard Bar', weightKg: 20.41 },
    { name: 'EZ Bar', weightKg: 6.8 },
    { name: "Women's Bar", weightKg: 15 },
    { name: 'No Bar', weightKg: 0 },
    { name: 'Sled', weightKg: 0, perSide: false },
  ],
  defaultBarIndex: 0,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLbs: [45, 35, 25, 10, 5, 2.5, 1.25],
};

interface PlateCalculatorProps {
  weightKg: number | null;
  units: 'METRIC' | 'IMPERIAL';
  /** Remembers the last bar used for this exercise, if given. */
  exerciseId?: string;
  onApply: (weightKg: number) => void;
  onClose: () => void;
}

// Last bar used per exercise: { [exerciseId]: barName }. Keyed by NAME rather
// than index because indices shift whenever a bar is added, removed, or
// reordered in settings — an index would silently point at a different bar.
const LAST_BAR_KEY = 'fittrackr_plate_last_bar';

function loadLastBars(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LAST_BAR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function rememberLastBar(exerciseId: string, barName: string) {
  try {
    localStorage.setItem(LAST_BAR_KEY, JSON.stringify({ ...loadLastBars(), [exerciseId]: barName }));
  } catch { /* ignore */ }
}

function loadConfig(): PlateConfig {
  if (typeof window === 'undefined') return DEFAULT_PLATE_CONFIG;
  try {
    const raw = localStorage.getItem('fittrackr_plate_config');
    if (!raw) return DEFAULT_PLATE_CONFIG;
    const parsed = JSON.parse(raw) as PlateConfig;
    if (!parsed.bars || !parsed.platesKg || !parsed.platesLbs) return DEFAULT_PLATE_CONFIG;
    return parsed;
  } catch {
    return DEFAULT_PLATE_CONFIG;
  }
}

/**
 * Greedy plate breakdown for one loadable end. `sides` is 2 for a barbell
 * (target split across both ends) and 1 for a sled/machine.
 */
function calcPlates(
  totalWeight: number,
  barWeight: number,
  availablePlates: number[],
  sides: 1 | 2,
): number[] {
  const remaining = totalWeight - barWeight;
  if (remaining <= 0) return [];
  const sorted = [...availablePlates].sort((a, b) => b - a);
  const result: number[] = [];
  let left = remaining / sides;
  for (const plate of sorted) {
    while (left >= plate - 0.001) {
      result.push(plate);
      left -= plate;
      if (left < 0.001) break;
    }
  }
  return result;
}

function plateColor(plate: number, isImperial: boolean): string {
  if (isImperial) {
    if (plate >= 45) return 'bg-red-500';
    if (plate >= 35) return 'bg-yellow-400';
    if (plate >= 25) return 'bg-green-500';
    if (plate >= 10) return 'bg-blue-500';
    if (plate >= 5) return 'bg-gray-400';
    return 'bg-orange-400';
  } else {
    if (plate >= 25) return 'bg-red-500';
    if (plate >= 20) return 'bg-yellow-400';
    if (plate >= 15) return 'bg-green-500';
    if (plate >= 5) return 'bg-blue-500';
    if (plate >= 2.5) return 'bg-gray-400';
    return 'bg-orange-400';
  }
}

function plateWidth(plate: number, isImperial: boolean): string {
  if (isImperial) {
    if (plate >= 45) return 'w-6';
    if (plate >= 35) return 'w-5';
    if (plate >= 25) return 'w-4';
    if (plate >= 10) return 'w-3.5';
    if (plate >= 5) return 'w-3';
    if (plate >= 2.5) return 'w-2.5';
    return 'w-2';
  } else {
    if (plate >= 25) return 'w-6';
    if (plate >= 20) return 'w-5';
    if (plate >= 15) return 'w-4';
    if (plate >= 10) return 'w-3.5';
    if (plate >= 5) return 'w-3';
    if (plate >= 2.5) return 'w-2.5';
    return 'w-2';
  }
}

export function PlateCalculator({ weightKg, units, exerciseId, onApply, onClose }: PlateCalculatorProps) {
  const isImperial = units === 'IMPERIAL';
  const [config] = useState<PlateConfig>(() => loadConfig());
  const [selectedBarIndex, setSelectedBarIndex] = useState(() => {
    // Prefer the bar last used for this exercise; fall back to the default.
    if (exerciseId) {
      const remembered = loadLastBars()[exerciseId];
      const idx = config.bars.findIndex((b) => b.name === remembered);
      if (idx !== -1) return idx;
    }
    return config.defaultBarIndex;
  });

  function selectBar(i: number) {
    setSelectedBarIndex(i);
    if (exerciseId) rememberLastBar(exerciseId, config.bars[i].name);
  }

  const toDisplay = (kg: number) =>
    isImperial ? Math.round(kg * 2.20462 * 10) / 10 : kg;

  const initialDisplay =
    weightKg != null ? String(toDisplay(weightKg)) : '';
  const [targetInput, setTargetInput] = useState(initialDisplay);

  const availablePlates = isImperial ? config.platesLbs : config.platesKg;
  const bar = config.bars[selectedBarIndex] ?? config.bars[0];
  const barDisplayWeight = toDisplay(bar.weightKg);

  const targetNum = parseFloat(targetInput);
  const validTarget = !isNaN(targetNum) && targetNum >= 0;

  const sides: 1 | 2 = isPerSide(bar) ? 2 : 1;
  const plates = validTarget ? calcPlates(targetNum, barDisplayWeight, availablePlates, sides) : [];
  const totalFromPlates = barDisplayWeight + plates.reduce((s, p) => s + p, 0) * sides;

  const barExceedsTarget = validTarget && barDisplayWeight > targetNum;

  function handleApply() {
    const displayVal = parseFloat(targetInput);
    if (isNaN(displayVal)) return;
    const kg = isImperial ? displayVal / 2.20462 : displayVal;
    onApply(Math.round(kg * 100) / 100);
    onClose();
  }

  const unitLabel = isImperial ? 'lbs' : 'kg';

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 mt-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Plate Calculator</span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {config.bars.map((b, i) => (
          <button
            key={i}
            type="button"
            onClick={() => selectBar(i)}
            className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
              selectedBarIndex === i
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-indigo-400'
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Target ({unitLabel})</label>
        <input
          type="text"
          inputMode="decimal"
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-center bg-white dark:bg-gray-800 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {validTarget && !barExceedsTarget && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Total: {totalFromPlates.toFixed(2)} {unitLabel}
          </span>
        )}
      </div>

      {/* Bar is a single square-ended shaft — no collars, no rounded caps, so it
          reads as one continuous piece rather than three stacked shapes. */}
      <div className="flex items-center justify-center mb-2 overflow-x-auto py-1">
        <div className="flex items-center">
          {sides === 2 && (
            <div className="flex items-center flex-row-reverse">
              {plates.map((p, i) => (
                <div
                  key={i}
                  className={`${plateWidth(p, isImperial)} h-10 mx-0.5 ${plateColor(p, isImperial)} opacity-90`}
                />
              ))}
            </div>
          )}
          <div className={`${sides === 2 ? 'w-20' : 'w-10'} h-2.5 bg-gray-500 dark:bg-gray-400`} />
          <div className="flex items-center">
            {plates.map((p, i) => (
              <div
                key={i}
                className={`${plateWidth(p, isImperial)} h-10 mx-0.5 ${plateColor(p, isImperial)} opacity-90`}
              />
            ))}
          </div>
          {sides === 1 && <div className="w-3 h-5 bg-gray-500 dark:bg-gray-400" />}
        </div>
      </div>

      <div className="text-center text-xs text-gray-500 dark:text-gray-400 mb-3">
        {barExceedsTarget ? (
          <span className="text-amber-500">Bar weight exceeds target</span>
        ) : plates.length === 0 ? (
          bar.weightKg > 0 ? (
            <span>
              Bar only ({bar.weightKg} kg / {Math.round(bar.weightKg * 2.20462 * 10) / 10} lbs)
            </span>
          ) : (
            <span>Unloaded</span>
          )
        ) : (
          <span>
            {sides === 2 ? 'Each side' : 'Load'}: {plates.join(' + ')} {unitLabel}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!validTarget}
          className="flex-1 py-1.5 rounded-lg bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
