'use client';

import { useState, useEffect, useCallback } from 'react';
import { TutorialTooltip } from './TutorialTooltip';
import type { TutorialStep } from './tutorial-steps';

interface TutorialOverlayProps {
  isActive: boolean;
  isNavigating: boolean;
  stepIndex: number;
  step: TutorialStep;
  totalSteps: number;
  next: () => void;
  back: () => void;
  skip: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

function findTarget(targetKey: string): Element | null {
  const isDesktop = window.innerWidth >= 1024;
  const preferred = document.querySelector(
    `[data-tutorial="${targetKey}"][data-tutorial-ctx="${isDesktop ? 'desktop' : 'mobile'}"]`,
  );
  if (preferred && (preferred as HTMLElement).offsetParent !== null) return preferred;

  // Fallback: any visible element with this tutorial key
  const all = document.querySelectorAll(`[data-tutorial="${targetKey}"]`);
  for (const el of all) {
    if ((el as HTMLElement).offsetParent !== null) return el;
  }
  // Last resort: return first match even if hidden (for elements like fixed navs)
  return all[0] ?? null;
}

function getTooltipPosition(
  targetRect: Rect,
  placement: TutorialStep['placement'],
  tooltipW: number,
  tooltipH: number,
) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;

  switch (placement) {
    case 'bottom':
      top = targetRect.top + targetRect.height + PAD + 12;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      // If tooltip would go off bottom, flip to top
      if (top + tooltipH > vh - 20) {
        top = targetRect.top - tooltipH - PAD - 12;
      }
      break;
    case 'top':
      top = targetRect.top - tooltipH - PAD - 12;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      // If tooltip would go off top, flip to bottom
      if (top < 20) {
        top = targetRect.top + targetRect.height + PAD + 12;
      }
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left + targetRect.width + PAD + 12;
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left - tooltipW - PAD - 12;
      break;
    default:
      break;
  }

  // Clamp to viewport
  left = Math.max(12, Math.min(left, vw - tooltipW - 12));
  top = Math.max(12, Math.min(top, vh - tooltipH - 12));

  return { top, left };
}

export function TutorialOverlay({
  isActive,
  isNavigating,
  stepIndex,
  step,
  totalSteps,
  next,
  back,
  skip,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    if (!step.targetKey) {
      setTargetRect(null);
      setTooltipPos(null);
      return;
    }
    const el = findTarget(step.targetKey);
    if (!el) {
      setTargetRect(null);
      setTooltipPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const rect = {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
    setTargetRect(rect);

    // Estimate tooltip size (288px = w-72, ~200px height)
    const pos = getTooltipPosition(rect, step.placement, 288, 200);
    setTooltipPos(pos);
  }, [step]);

  useEffect(() => {
    if (!isActive || isNavigating) return;
    // Small delay to let DOM settle
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [isActive, isNavigating, stepIndex, measure]);

  // Recalculate on resize/scroll
  useEffect(() => {
    if (!isActive) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isActive, measure]);

  // Body scroll lock (release during navigation so pages can render)
  useEffect(() => {
    if (isActive && !isNavigating) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    document.body.style.overflow = '';
  }, [isActive, isNavigating]);

  // Escape key to skip
  useEffect(() => {
    if (!isActive) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') skip();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, skip]);

  if (!isActive) return null;

  // While navigating, show dark overlay only (no tooltip or spotlight)
  if (isNavigating) {
    return (
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/60" />
      </div>
    );
  }

  const isCentered = !step.targetKey;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* SVG overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="tutorial-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="12"
                fill="black"
                style={{ transition: 'all 300ms ease' }}
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Click blocker (allows clicks through the spotlight cutout) */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Tooltip */}
      <div
        className="absolute"
        style={
          isCentered
            ? {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 61,
                pointerEvents: 'auto',
              }
            : tooltipPos
              ? {
                  top: tooltipPos.top,
                  left: tooltipPos.left,
                  transition: 'top 300ms ease, left 300ms ease',
                  zIndex: 61,
                  pointerEvents: 'auto',
                }
              : { opacity: 0, zIndex: 61, pointerEvents: 'auto' }
        }
      >
        <TutorialTooltip
          step={step}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      </div>
    </div>
  );
}
