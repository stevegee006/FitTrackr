'use client';

import { useEffect, useState } from 'react';

const EMOJIS = ['🎉', '🎊', '🏆', '💪', '🔥', '⭐', '🙌', '👏', '✨', '🥳'];

/**
 * One-shot handoff from Finish to the summary page. sessionStorage rather than
 * a query param so the celebration fires only on the redirect that follows
 * finishing — revisiting an old summary, or reloading, shows nothing. Also
 * avoids needing a Suspense boundary for useSearchParams.
 */
const CELEBRATE_KEY = 'fittrackr:celebrate';

export function markCelebrate(workoutId: string) {
  try { sessionStorage.setItem(CELEBRATE_KEY, workoutId); } catch { /* ignore */ }
}

/** True at most once per finish, and only for the matching workout. */
export function consumeCelebrate(workoutId: string): boolean {
  try {
    if (sessionStorage.getItem(CELEBRATE_KEY) !== workoutId) return false;
    sessionStorage.removeItem(CELEBRATE_KEY);
    return true;
  } catch {
    return false;
  }
}

const COUNT = 30;
/** Longest possible life of a particle (delay + duration), used to unmount. */
const MAX_LIFE_MS = 4200;

interface Particle {
  id: number;
  emoji: string;
  left: number;
  dx: number;
  rise: number;
  rot: number;
  duration: number;
  delay: number;
  size: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: COUNT }, (_, id) => ({
    id,
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    // Spread launch points across the width, nudged so they don't line up.
    left: (id / COUNT) * 100 + (Math.random() * 8 - 4),
    dx: Math.random() * 160 - 80,
    // Most reach the upper half; a few overshoot for variety.
    rise: 55 + Math.random() * 45,
    rot: Math.random() * 720 - 360,
    duration: 2200 + Math.random() * 1200,
    delay: Math.random() * 600,
    size: 20 + Math.random() * 18,
  }));
}

/**
 * One-shot emoji burst: launches from below the viewport, peaks, then falls
 * back out the bottom. Unmounts itself once the last particle is done, so
 * nothing keeps compositing afterwards.
 *
 * Particles are generated in an effect rather than during render — Math.random
 * at render time would differ between the server pass and hydration.
 */
export function CelebrationBurst({ onDone }: { onDone?: () => void }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    setParticles(makeParticles());
    const t = setTimeout(() => {
      setParticles([]);
      onDone?.();
    }, MAX_LIFE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (particles.length === 0) return null;

  return (
    // pointer-events-none is essential: this covers the whole screen and would
    // otherwise swallow every tap on the summary underneath.
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[150] overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="ft-celebrate-particle absolute select-none"
          style={{
            left: `${p.left}%`,
            bottom: '-3rem',
            fontSize: `${p.size}px`,
            lineHeight: 1,
            animation: `ft-celebrate ${p.duration}ms cubic-bezier(0.22, 0.9, 0.3, 1) ${p.delay}ms both`,
            // Consumed by the keyframes in globals.css.
            ['--ft-dx' as string]: `${p.dx}px`,
            ['--ft-rise' as string]: `${p.rise}vh`,
            ['--ft-rot' as string]: `${p.rot}deg`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
