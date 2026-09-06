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
  /**
   * Where this step's target has got to.
   *
   *  - `resolving` — still looking. Dim overlay and NOTHING else.
   *  - `ready`     — found and measured; spotlight it.
   *  - `missing`   — not on this page. Fall back to a centred card.
   *
   * Three states because the two failure modes are different, and both used to
   * render as "tooltip with no position", i.e. invisible.
   *
   * A genuinely absent target ENDED the tour: `start-workout` only exists in
   * the dashboard's empty state, so the tour died there for anyone who had
   * trained that week. `missing` makes that cost a highlight, not the tour.
   *
   * A target that has not mounted YET is the common case on steps that
   * navigate — the generator cards on Programs and Training Goals render only
   * once their queries resolve. Rendering an unpositioned tooltip while
   * waiting is what made those steps flicker before settling; `resolving`
   * shows the dim overlay alone, so the step simply appears when it is ready.
   */
  const [phase, setPhase] = useState<'resolving' | 'ready' | 'missing'>('resolving');

  const measure = useCallback((): boolean => {
    if (!step.targetKey) {
      setTargetRect(null);
      setTooltipPos(null);
      return true;
    }
    const el = findTarget(step.targetKey);
    if (!el) {
      setTargetRect(null);
      setTooltipPos(null);
      return false;
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
    return true;
  }, [step]);

  useEffect(() => {
    if (!isActive || isNavigating) return;

    if (!step.targetKey) {
      measure();
      setPhase('ready');
      return;
    }

    setPhase('resolving');

    // Polled rather than measured once: a single shot cannot tell "not on this
    // page" from "this page has not finished rendering", and steps reached via
    // `route` are routinely still mounting. 100ms keeps the appearance prompt
    // without a visible staircase; 2.5s is long enough for a query to resolve
    // and short enough not to feel stuck.
    const INTERVAL = 100;
    const LIMIT = 2500;
    let waited = 0;
    let settled = false;
    let cancelled = false;

    function attempt() {
      if (settled || cancelled) return;
      if (measure()) {
        settled = true;
        setPhase('ready');
        // One more pass once the page has stopped moving. A card measured the
        // instant it mounts is often measured before its data, images and
        // fonts land, which leaves the spotlight sitting slightly off it.
        window.setTimeout(() => { if (!cancelled) measure(); }, 350);
        return;
      }
      waited += INTERVAL;
      if (waited >= LIMIT) {
        settled = true;
        setPhase('missing');
      }
    }

    attempt();
    const poll = window.setInterval(() => {
      if (cancelled || settled) return window.clearInterval(poll);
      attempt();
    }, INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [isActive, isNavigating, stepIndex, measure, step.targetKey]);

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

  // While navigating, or while the step's target is still mounting, show the
  // dim overlay ONLY. Rendering the tooltip before it can be positioned is
  // what produced the flicker on the Programs and Training Goals steps.
  if (isNavigating || phase === 'resolving') {
    return (
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/60" />
      </div>
    );
  }

  const isCentered = !step.targetKey || phase === 'missing';

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
