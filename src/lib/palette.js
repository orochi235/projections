import { interpolateLab } from 'd3-interpolate';

// The two projections own the two hues, and every mode reuses them: magenta is
// always the first projection, teal is always the second. Nothing else in the
// interface is allowed to be either colour.
export const PALETTE = {
  sheet: '#E7EDEE',
  sheetDeep: '#D6E0E2',
  ink: '#1B2E3A',
  inkSoft: '#5C7080',
  hairline: '#A9BAC0',
  land: '#DCCFAE',
  a: '#BC1A7B',
  b: '#0A7A87',
};

const towardA = interpolateLab(PALETTE.sheet, PALETTE.a);
const towardB = interpolateLab(PALETTE.sheet, PALETTE.b);

/**
 * Diverging ramp over [-1, 1]. Positive means the first projection is bigger or
 * more deformed at that point, negative means the second one is.
 */
export function diverging(t) {
  if (!Number.isFinite(t)) return PALETTE.sheetDeep;
  const clamped = Math.max(-1, Math.min(1, t));
  return clamped >= 0 ? towardA(clamped) : towardB(-clamped);
}
