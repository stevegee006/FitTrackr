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
 * All of these are built from the SAME barbell mark as `logo.svg` — one
 * continuous bar with two plates and two collars — and differentiated by
 * direction rather than by drawing a different object. Push presses up, pull
 * pulls down, legs hangs beneath the bar. Everything is `currentColor` on
 * `stroke`, so each icon takes the colour of the type it belongs to.
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

    // Bar across the shoulders, legs beneath it.
    case 'LEGS':
      return svg(
        <>
          <Barbell y={6} />
          <path d="M9.5 10v4l-2 6" />
          <path d="M14.5 10v4l2 6" />
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

    // FULL_BODY and anything unrecognised: the plain mark.
    default:
      return svg(<Barbell y={12} />);
  }
}
