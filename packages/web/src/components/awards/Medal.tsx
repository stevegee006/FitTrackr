'use client';

export type MedalTier = 'STEEL' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

interface Metal {
  /** Outer rim, face, and highlight — a three-stop metal so it reads struck. */
  rim: string;
  rimDark: string;
  face: string;
  faceDark: string;
  shine: string;
  text: string;
  ribbon: string;
  ribbonDark: string;
}

const METALS: Record<MedalTier, Metal> = {
  STEEL: {
    rim: '#94a3b8', rimDark: '#64748b', face: '#cbd5e1', faceDark: '#94a3b8',
    shine: '#f1f5f9', text: '#334155', ribbon: '#64748b', ribbonDark: '#475569',
  },
  BRONZE: {
    rim: '#c2833f', rimDark: '#8a5a24', face: '#e0a45f', faceDark: '#b3762f',
    shine: '#f3cd9a', text: '#5c3a11', ribbon: '#8a5a24', ribbonDark: '#6b4419',
  },
  SILVER: {
    rim: '#adb8c6', rimDark: '#7d8794', face: '#dce3ea', faceDark: '#a9b3c0',
    shine: '#ffffff', text: '#3f4956', ribbon: '#7d8794', ribbonDark: '#5d6673',
  },
  GOLD: {
    rim: '#d4a017', rimDark: '#9a7209', face: '#f5cb45', faceDark: '#d2a418',
    shine: '#fff2b8', text: '#5c4506', ribbon: '#b8860b', ribbonDark: '#8a6508',
  },
  PLATINUM: {
    rim: '#8fd3d8', rimDark: '#4f9ba1', face: '#d6f2f4', faceDark: '#9ed6db',
    shine: '#ffffff', text: '#22585c', ribbon: '#4f9ba1', ribbonDark: '#3a767b',
  },
};

interface MedalProps {
  tier: MedalTier;
  /** Struck on the face — "225", "2×". */
  label: string;
  /** Locked medals render unstruck: grey, flat, no shine. */
  earned?: boolean;
  size?: number;
  title?: string;
}

/**
 * A struck medal: ribbon, milled rim, raised face and an engraved value.
 *
 * Drawn as inline SVG rather than an emoji so it scales cleanly, carries the
 * actual number, and can show a distinct locked state. Gradient ids are
 * suffixed per instance — several medals share a page and duplicate ids would
 * make every one of them render with the first medal's metal.
 */
export function Medal({ tier, label, earned = true, size = 64, title }: MedalProps) {
  const m = METALS[tier];
  const uid = `${tier}-${label}-${earned ? 'e' : 'l'}`.replace(/[^a-zA-Z0-9-]/g, '');
  const faceId = `mf-${uid}`;
  const rimId = `mr-${uid}`;

  // Locked medals keep the shape but lose the metal, so the shelf still reads
  // as "these exist and you haven't got them yet".
  const rim = earned ? m.rim : '#9ca3af';
  const rimDark = earned ? m.rimDark : '#6b7280';
  const face = earned ? m.face : '#d1d5db';
  const faceDark = earned ? m.faceDark : '#9ca3af';
  const text = earned ? m.text : '#6b7280';
  const ribbon = earned ? m.ribbon : '#9ca3af';
  const ribbonDark = earned ? m.ribbonDark : '#6b7280';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title ?? label}
      className={earned ? '' : 'opacity-45'}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={faceId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={face} />
          <stop offset="55%" stopColor={faceDark} />
          <stop offset="100%" stopColor={face} />
        </linearGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={rim} />
          <stop offset="50%" stopColor={rimDark} />
          <stop offset="100%" stopColor={rim} />
        </linearGradient>
      </defs>

      {/* Ribbon: two tails behind the disc */}
      <path d="M20 2 L28 2 L34 24 L24 28 Z" fill={ribbonDark} />
      <path d="M44 2 L36 2 L30 24 L40 28 Z" fill={ribbon} />

      {/* Milled rim */}
      <circle cx="32" cy="41" r="20" fill={`url(#${rimId})`} />
      {/* Milling notches, suppressed when locked so it reads flat */}
      {earned && Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={32 + Math.cos(a) * 17.5} y1={41 + Math.sin(a) * 17.5}
            x2={32 + Math.cos(a) * 20} y2={41 + Math.sin(a) * 20}
            stroke={rimDark} strokeWidth="1" opacity="0.5"
          />
        );
      })}

      {/* Raised face */}
      <circle cx="32" cy="41" r="15.5" fill={`url(#${faceId})`} />
      <circle cx="32" cy="41" r="15.5" fill="none" stroke={rimDark} strokeWidth="0.75" opacity="0.6" />

      {/* Specular highlight — the thing that makes it look struck rather than printed */}
      {earned && (
        <ellipse cx="26" cy="33" rx="7" ry="4.5" fill={m.shine} opacity="0.4" transform="rotate(-35 26 33)" />
      )}

      <text
        x="32" y="41"
        textAnchor="middle" dominantBaseline="central"
        fill={text}
        fontSize={label.length > 3 ? 10 : 13}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}
