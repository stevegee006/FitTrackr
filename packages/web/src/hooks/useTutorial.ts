'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { TUTORIAL_STEPS } from '@/components/tutorial/tutorial-steps';

const STORAGE_KEY = 'FitTrackr-tutorial-complete';

export function useTutorial() {
  const router = useRouter();
  const pathname = usePathname();
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);

  // Auto-start on first visit (after a short delay for dashboard to load)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setIsActive(true);
        setStepIndex(0);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Listen for restart event from Settings page
  useEffect(() => {
    function handleRestart() {
      setStepIndex(0);
      setIsActive(true);
      // Step 0 has route '/dashboard', navigation handled by goToStep effect
    }
    window.addEventListener('tutorial-restart', handleRestart);
    return () => window.removeEventListener('tutorial-restart', handleRestart);
  }, []);

  // Navigate to step's route and poll for target element
  useEffect(() => {
    if (!isActive) return;
    const step = TUTORIAL_STEPS[stepIndex];
    if (!step) return;

    // If step has a route and we're not on it, navigate
    if (step.route && pathname !== step.route) {
      setIsNavigating(true);
      router.push(step.route);
      return; // Wait for pathname to change, then re-run
    }

    // If we have a target, poll for it to appear in DOM
    if (step.targetKey) {
      // Check if element already exists (avoids unnecessary isNavigating flash)
      const existing = document.querySelector(`[data-tutorial="${step.targetKey}"]`);
      if (existing) {
        setIsNavigating(false);
        return;
      }

      setIsNavigating(true);
      let cancelled = false;
      const deadline = Date.now() + 3000;

      function poll() {
        if (cancelled) return;
        const el = document.querySelector(`[data-tutorial="${step.targetKey}"]`);
        if (el || Date.now() > deadline) {
          setIsNavigating(false);
          return;
        }
        requestAnimationFrame(poll);
      }

      // Small delay to let the page render after navigation
      const timer = setTimeout(() => requestAnimationFrame(poll), 100);
      return () => { cancelled = true; clearTimeout(timer); };
    }

    // No target needed (centered modal) — ready immediately
    setIsNavigating(false);
  }, [isActive, stepIndex, pathname, router]);

  const complete = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  const next = useCallback(() => {
    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      complete();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, complete]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const skip = useCallback(() => {
    complete();
  }, [complete]);

  const restart = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setStepIndex(0);
    setIsActive(true);
  }, []);

  return {
    isActive,
    isNavigating,
    stepIndex,
    step: TUTORIAL_STEPS[stepIndex],
    totalSteps: TUTORIAL_STEPS.length,
    next,
    back,
    skip,
    restart,
  };
}
