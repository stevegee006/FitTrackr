/**
 * Generate FitTrackr PWA icons. Run: node generate-icons.mjs
 */
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let sharp;
const tryPaths = [
  'sharp',
  'C:/Users/steve/AppData/Roaming/npm/node_modules/sharp',
];
for (const p of tryPaths) {
  try { sharp = require(p); break; } catch { /* continue */ }
}
if (!sharp) { console.error('sharp not found'); process.exit(1); }

// The bar is ONE continuous square-ended shaft drawn first, with the plates
// stacked on top of it — so the mark reads as a single object rather than five
// separate blocks. Knurling was removed: at favicon size those 5px marks merged
// into a smudge. Same palette as before.
//
// Geometry lives in a 320-unit space centred on (0,0). makeSplashSvg reuses the
// SAME numbers via a scale(ico/320) transform, so the two must stay in sync.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  <g transform="translate(256,256)">
    <rect x="-128" y="-16" width="256" height="32"  fill="#e0e7ff"/>
    <rect x="-126" y="-76" width="48"  height="152" rx="7" fill="#a5b4fc"/>
    <rect x="78"   y="-76" width="48"  height="152" rx="7" fill="#a5b4fc"/>
    <rect x="-164" y="-52" width="38"  height="104" rx="7" fill="#c7d2fe"/>
    <rect x="126"  y="-52" width="38"  height="104" rx="7" fill="#c7d2fe"/>
  </g>
</svg>`;

function makeSplashSvg(w, h) {
  const ico = Math.min(w, h) * 0.28;
  const cx = w / 2;
  const cy = h / 2;
  const ty = cy - ico / 2 - 32;
  const fontSize = ico * 0.22;
  const textY = cy + ico / 2 + 16;
  // Scale factor: barbell paths are designed for a 320-unit coordinate space (centred at 0,0)
  // We map that into `ico` pixels by scaling ico/320
  const s = ico / 320;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#030712"/>
  <!-- Barbell icon — no background box, paths rendered directly on dark bg.
       Same geometry as ICON_SVG; splash palette is brightened for the dark
       backdrop (outer #6366f1 / inner #818cf8 vs the icon's pale tints). -->
  <g transform="translate(${cx},${ty + ico / 2}) scale(${s})">
    <!-- bar: one continuous square-ended shaft, drawn under the plates. Its
         ends stop inside the outer plates so no sliver shows between plates. -->
    <rect x="-128" y="-16" width="256" height="32"  fill="#e0e7ff"/>
    <!-- inner plates -->
    <rect x="-126" y="-76" width="48"  height="152" rx="7" fill="#818cf8"/>
    <rect x="78"   y="-76" width="48"  height="152" rx="7" fill="#818cf8"/>
    <!-- outer plates — butt directly against the inner plates -->
    <rect x="-164" y="-52" width="38"  height="104" rx="7" fill="#6366f1"/>
    <rect x="126"  y="-52" width="38"  height="104" rx="7" fill="#6366f1"/>
  </g>
  <!-- Wordmark matches the login page: bold "Fit" + light "Trackr", in the
       dark-mode greys (gray-100 / gray-500).
       NOTE: font-family must name REAL families. librsvg (what sharp uses to
       rasterise) does not resolve "system-ui", and silently fell back to a
       monospace default — which is why the old splash looked like code. -->
  <text x="${cx}" y="${textY}" text-anchor="middle"
    font-family="Segoe UI,Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="${fontSize}"><tspan font-weight="700" fill="#f3f4f6">Fit</tspan><tspan font-weight="300" fill="#6b7280">Trackr</tspan></text>
</svg>`;
}

const pub = join(__dir, 'packages/web/public');
mkdirSync(join(pub, 'icons'),  { recursive: true });
mkdirSync(join(pub, 'splash'), { recursive: true });

const iconBuf = Buffer.from(ICON_SVG);

async function run() {
  await sharp(iconBuf, { density: 300 }).resize(192, 192).png().toFile(join(pub, 'icons/icon-192.png'));
  console.log('✓ icons/icon-192.png');
  await sharp(iconBuf, { density: 300 }).resize(512, 512).png().toFile(join(pub, 'icons/icon-512.png'));
  console.log('✓ icons/icon-512.png');
  await sharp(iconBuf, { density: 300 }).resize(180, 180).png().toFile(join(pub, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  const splashes = [
    ['v2-iPhone_16_Pro_Max.png', 1320, 2868],
    ['v2-iPhone_16_Pro.png',     1206, 2622],
    ['v2-iPhone_16_Plus.png',    1290, 2796],
    ['v2-iPhone_16.png',         1179, 2556],
    ['v2-iPhone_15_Pro_Max.png', 1290, 2796],
    ['v2-iPhone_15_Pro.png',     1179, 2556],
    ['v2-iPhone_14.png',         1170, 2532],
    ['v2-iPhone_X.png',          1125, 2436],
    ['v2-iPhone_8_Plus.png',     1242, 2208],
    ['v2-iPhone_8.png',           750, 1334],
    ['v2-iPad_mini_6.png',       1488, 2266],
    ['v2-iPad_Air_11.png',       1668, 2388],
    ['v2-iPad_Pro_11.png',       1668, 2388],
    ['v2-iPad_Pro_12.png',       2048, 2732],
  ];

  for (let i = 0; i < splashes.length; i++) {
    const entry = splashes[i];
    const fname = entry[0];
    const w = entry[1];
    const h = entry[2];
    const buf = Buffer.from(makeSplashSvg(w, h));
    await sharp(buf, { density: 150 }).resize(w, h).png().toFile(join(pub, 'splash', fname));
    console.log('✓ splash/' + fname);
  }

  console.log('\nAll icons generated ✓');
}

run().catch(err => { console.error(err); process.exit(1); });
