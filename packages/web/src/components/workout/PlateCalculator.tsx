'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface PlateConfig {
  bars: Array<{ name: string; weightKg: number }>;
  defaultBarIndex: number;
  platesKg: number[];
  platesLbs: number[];
}

const DEFAULT_PLATE_CONFIG: PlateConfig = {
  bars: [
    { name: 'Standard Bar', weightKg: 20.41 },
    { name: 'EZ Bar', weightKg: 6.8 },
    { name: "Women's Bar", weightKg: 15 },
    { name: 'No Bar', weightKg: 0 },
  ],
  defaultBarIndex: 0,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLbs: [45, 35, 25, 10, 5, 2.5, 1.25],
};

interface PlateCalculatorProps {
  weightKg: number | null;
  units: 'METRIC' | 'IMPERIAL';
  onApply: (weightKg: number) => void;
  onClose: () => void;
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

function calcPlatesPerSide(totalWeight: number, barWeight: number, availablePlates: number[]): number[] {
  const remaining = totalWeight - barWeight;
  if (remaining <= 0) return [];
  const perSide = remaining / 2;
  const sorted = [...availablePlates].sort((a, b) => b - a);
  const result: number[] = [];
  let left = perSide;
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

export function PlateCalculator({ weightKg, units, onApply, onClose }: PlateCalculatorProps) {
  const isImperial = units === 'IMPERIAL';
  const [config] = useState<PlateConfig>(() => loadConfig());
  const [selectedBarIndex, setSelectedBarIndex] = useState(() => config.defaultBarIndex);

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

  const plates = validTarget ? calcPlatesPerSide(targetNum, barDisplayWeight, availablePlates) : [];
  const totalFromPlates = barDisplayWeight + plates.reduce((s, p) => s + p, 0) * 2;

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
            onClick={() => setSelectedBarIndex(i)}
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

      <div className="flex items-center justify-center mb-2 overflow-x-auto py-1">
        <div className="flex items-center">
          <div className="flex items-center flex-row-reverse">
            {plates.map((p, i) => (
              <div
                key={i}
                className={`${plateWidth(p, isImperial)} h-10 rounded-sm mx-0.5 ${plateColor(p, isImperial)} opacity-90`}
              />
            ))}
          </div>
          <div className="w-2 h-4 bg-gray-400 dark:bg-gray-500 rounded-sm" />
          <div className="w-16 h-2 bg-gray-500 dark:bg-gray-400 rounded-full" />
          <div className="w-2 h-4 bg-gray-400 dark:bg-gray-500 rounded-sm" />
          <div className="flex items-center">
            {plates.map((p, i) => (
              <div
                key={i}
                className={`${plateWidth(p, isImperial)} h-10 rounded-sm mx-0.5 ${plateColor(p, isImperial)} opacity-90`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-gray-500 dark:text-gray-400 mb-3">
        {barExceedsTarget ? (
          <span className="text-amber-500">Bar weight exceeds target</span>
        ) : plates.length === 0 ? (
          <span>
            Bar only ({bar.weightKg} kg / {Math.round(bar.weightKg * 2.20462 * 10) / 10} lbs)
          </span>
        ) : (
          <span>Each side: {plates.join(' + ')} {unitLabel}</span>
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
