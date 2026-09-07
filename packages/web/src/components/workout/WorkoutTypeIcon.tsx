import type { WorkoutType } from '@fittrackr/shared';

/**
 * Line icons for the workout types, replacing the emoji (🤜 🤛 🦵 💪) the
 * quick-start buttons used.
 *
 * Emoji were wrong here for reasons beyond taste: they render in the platform's
 * own colour, so they ignored the workout-type colour sitting right next to
 * them, and they look different on every device — the iPhone's 🦵 is not the
 * one Chrome on Windows draws.
 *
 * Most are built from the SAME barbell mark as `logo.svg` — one continuous bar
 * with two plates and two collars — and differentiated by direction rather than
 * by drawing a different object: push presses up, pull pulls down. Everything is
 * `currentColor` on `stroke`, so each icon takes the colour of its type.
 *
 * Three deliberately break that rule, because a barbell cannot say what they
 * mean. CARDIO is the one type that is not a lift. LEGS and FULL_BODY are about
 * the BODY rather than the movement — a bar with lines hanging off it read as
 * an insect rather than as legs, and FULL_BODY was the bare barbell, which is
 * also the fallback for anything unrecognised, so it said nothing at all.
 *
 * The geometry is duplicated from `generate-icons.mjs` only in spirit, not in
 * fact: these are their own small paths, so changing the app icon does not
 * require touching them.
 */

const COMMON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Bar, two plates, two collars — centred on `y`. */
function Barbell({ y }: { y: number }) {
  return (
    <>
      <path d={`M4 ${y}h16`} />
      <path d={`M7.5 ${y - 3.5}v7`} />
      <path d={`M16.5 ${y - 3.5}v7`} />
      <path d={`M4.5 ${y - 1.5}v3`} />
      <path d={`M19.5 ${y - 1.5}v3`} />
    </>
  );
}

export function WorkoutTypeIcon({
  type,
  className = 'h-5 w-5',
  style,
}: {
  type: WorkoutType | string;
  className?: string;
  /** Usually `{ color: WORKOUT_TYPE_COLORS[type] }` — the strokes are currentColor. */
  style?: React.CSSProperties;
}) {
  const svg = (children: React.ReactNode) => (
    <svg {...COMMON} className={className} style={style} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );

  switch (type) {
    // Bar low, driven upward.
    case 'PUSH':
      return svg(<><Barbell y={17} /><path d="M12 11V4" /><path d="M9 7l3-3 3 3" /></>);

    // Bar high, pulled down.
    case 'PULL':
      return svg(<><Barbell y={7} /><path d="M12 13v7" /><path d="M9 17l3 3 3-3" /></>);

    /**
     * A pair of legs, hips to feet.
     *
     * The FEET are what make this work. It was previously a barbell with two
     * lines hanging beneath it, and without anything terminating them they read
     * as tentacles — the mark needs something at the bottom to say "these are
     * limbs standing on the ground". The bar is gone for the same reason the
     * cardio icon has none: at this size there is not room for both a barbell
     * and a body, and the body is the part that means "legs".
     */
    case 'LEGS':
      return svg(
        <>
          <path d="M9 4h6" />
          <path d="M9.5 4v8l-1.5 5" />
          <path d="M14.5 4v8l1.5 5" />
          <path d="M5.5 17.5h4" />
          <path d="M14.5 17.5h4" />
        </>,
      );

    case 'UPPER':
      return svg(<><Barbell y={14} /><path d="M7 8a5 5 0 0 1 10 0" /></>);

    case 'LOWER':
      return svg(<><Barbell y={10} /><path d="M7 16a5 5 0 0 0 10 0" /></>);

    // Deliberately not a barbell: cardio is the one type that is not a lift.
    case 'CARDIO':
      return svg(<path d="M3 12h3.5l2-5 3.5 10 2.5-5H21" />);

    case 'CUSTOM':
      return svg(
        <>
          <Barbell y={13} />
          <path d="M18.5 3.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </>,
      );

    /**
     * A whole figure: head, arms, torso, legs.
     *
     * Was the bare barbell — which is also the fallback below for anything
     * unrecognised, so "Full Body" and "no idea what this is" drew the same
     * mark. A body says the thing the name says.
     */
    case 'FULL_BODY':
      return svg(
        <>
          <circle cx="12" cy="4.5" r="2" />
          <path d="M12 6.5v6" />
          <path d="M7 9.5h10" />
          <path d="M12 12.5l-3 7" />
          <path d="M12 12.5l3 7" />
        </>,
      );

    // Anything unrecognised: the plain mark.
    default:
      return svg(<Barbell y={12} />);
  }
}
