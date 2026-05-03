'use client';

import type { TutorialStep } from './tutorial-steps';

interface TutorialTooltipProps {
  step: TutorialStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TutorialTooltip({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onBack,
  onSkip,
}: TutorialTooltipProps) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  return (
    <div className="w-72 rounded-xl bg-white shadow-xl border border-gray-200 dark:bg-gray-900 dark:border-gray-700 p-4 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{step.title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{step.body}</p>
      </div>

      {/* Step dots */}
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === stepIndex ? 'w-4 bg-emerald-600' : 'w-1.5 bg-gray-300 dark:bg-gray-600'
            }`}
          />
        ))}
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Skip
        </button>
        <div className="flex gap-2">
          {!isFirst && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
