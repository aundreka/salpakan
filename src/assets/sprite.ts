/**
 * Every piece is one insignia glyph on one tile. The glyphs live here as SVG symbols,
 * drawn once in a 100×100 box and recolored through CSS (fill: currentColor).
 * Team colors and finish come from theme.css, so the art style is a stylesheet change.
 */
import type { Rank } from '../engine/types';

const star = (x: number, y: number, s: number) =>
  `<use href="#sym-star" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}"/>`;
const sun = (x: number, y: number, s: number) =>
  `<use href="#sym-sun" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}"/>`;
const bars = (ys: number[]) => ys.map((y) => `<rect x="24" y="${y - 4.5}" width="52" height="9" rx="2"/>`).join('');
const chevrons = (ys: number[]) =>
  ys.map((y) => `<polyline points="30,${y} 50,${y - 14} 70,${y}" class="stroke"/>`).join('');

export const INSIGNIA: Record<Rank | 'BACK', string> = {
  G5: [[24, 38], [50, 38], [76, 38], [37, 62], [63, 62]].map(([x, y]) => star(x, y, 21)).join(''),
  G4: [[35, 38], [65, 38], [35, 64], [65, 64]].map(([x, y]) => star(x, y, 24)).join(''),
  G3: [[50, 36], [34, 64], [66, 64]].map(([x, y]) => star(x, y, 26)).join(''),
  G2: [[36, 50], [64, 50]].map(([x, y]) => star(x, y, 28)).join(''),
  G1: star(50, 50, 34),
  COL: [[26, 50], [50, 50], [74, 50]].map(([x, y]) => sun(x, y, 22)).join(''),
  LTC: [[37, 50], [63, 50]].map(([x, y]) => sun(x, y, 25)).join(''),
  MAJ: sun(50, 50, 32),
  CPT: bars([34, 50, 66]),
  LT1: bars([42, 58]),
  LT2: bars([50]),
  SGT: chevrons([42, 56, 70]),
  PVT: chevrons([57]),
  SPY: `<path d="M16,50 Q31,35 46,50 Q31,65 16,50Z" class="stroke thin"/><circle cx="31" cy="50" r="5"/>
        <path d="M54,50 Q69,35 84,50 Q69,65 54,50Z" class="stroke thin"/><circle cx="69" cy="50" r="5"/>`,
  FLG: `<line x1="32" y1="22" x2="32" y2="80" class="stroke thin"/><path d="M35,24 L74,35 L35,46Z"/>`,
  BACK: `<g class="back"><circle cx="50" cy="50" r="17" class="stroke thin"/><circle cx="50" cy="50" r="4"/></g>`,
};

export function spriteMarkup(): string {
  const symbols = (Object.keys(INSIGNIA) as (keyof typeof INSIGNIA)[])
    .map((k) => `<symbol id="ins-${k}" viewBox="0 0 100 100">${INSIGNIA[k]}</symbol>`)
    .join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="sym-star" viewBox="-10.5 -10.5 21 21"><polygon points="0,-10 2.47,-3.4 9.51,-3.09 3.99,1.3 5.88,8.09 0,4.2 -5.88,8.09 -3.99,1.3 -9.51,-3.09 -2.47,-3.4"/></symbol>
    <symbol id="sym-sun" viewBox="-10.5 -10.5 21 21"><path fill-rule="evenodd" d="M0,-9 A9,9 0 1,1 0,9 A9,9 0 1,1 0,-9 Z M0,-5.2 L4.8,3.2 L-4.8,3.2 Z"/></symbol>
    ${symbols}
  </defs></svg>`;
}

export const LOGO_MARK = `<svg viewBox="0 0 64 64" class="logo-mark" aria-hidden="true"><rect x="4" y="4" width="56" height="56" rx="10" fill="var(--navy)"/><rect x="4" y="52" width="56" height="8" rx="4" fill="var(--navy-deep)"/><g fill="var(--brass)"><polygon points="32,14 34.2,20.5 41,20.8 35.6,25 37.4,31.6 32,27.8 26.6,31.6 28.4,25 23,20.8 29.8,20.5"/><polygon points="17,30 18.7,35 24,35.2 19.8,38.4 21.2,43.6 17,40.6 12.8,43.6 14.2,38.4 10,35.2 15.3,35"/><polygon points="47,30 48.7,35 54,35.2 49.8,38.4 51.2,43.6 47,40.6 42.8,43.6 44.2,38.4 40,35.2 45.3,35"/></g></svg>`;
