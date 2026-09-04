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

/**
 * Multiplies a colour toward black. Takes either of the two forms in play here:
 * the hex literals above and the `rgb(...)` strings d3's interpolators return.
 */
export function shade(color, factor) {
  const t = Math.max(0, Math.min(1, factor));
  let r;
  let g;
  let b;
  if (color[0] === '#') {
    const hex = parseInt(color.slice(1), 16);
    r = (hex >> 16) & 255;
    g = (hex >> 8) & 255;
    b = hex & 255;
  } else {
    [r, g, b] = color.match(/[\d.]+/g).map(Number);
  }
  return `rgb(${Math.round(r * t)}, ${Math.round(g * t)}, ${Math.round(b * t)})`;
}

// Quantized lookups. The globe sets a fill colour per quad, tens of thousands of
// times a frame, and both halves of that — interpolating the ramp and building
// an "rgb(...)" string — cost more than the drawing does. Neither the eye nor
// the canvas can tell 96 steps of ramp and 64 of shading from continuous ones.
const RAMP_STEPS = 96;
const SHADE_STEPS = 64;

const RAMP = Array.from({ length: RAMP_STEPS }, (_, index) =>
  diverging((index / (RAMP_STEPS - 1)) * 2 - 1),
);
const shadeCache = new Map();

/** `diverging`, snapped to a fixed set of colours so results can be cached. */
export function divergingStep(t) {
  if (!Number.isFinite(t)) return PALETTE.sheetDeep;
  const clamped = Math.max(-1, Math.min(1, t));
  return RAMP[Math.round(((clamped + 1) / 2) * (RAMP_STEPS - 1))];
}

/** `shade`, snapped and memoized. Feed it colours from a bounded set. */
export function shadeStep(color, factor) {
  const level = Math.max(0, Math.min(SHADE_STEPS - 1, Math.round(factor * (SHADE_STEPS - 1))));
  const key = `${color}|${level}`;
  let cached = shadeCache.get(key);
  if (cached === undefined) {
    cached = shade(color, level / (SHADE_STEPS - 1));
    shadeCache.set(key, cached);
  }
  return cached;
}

// Each hue gets its own lazily built white-to-full ramp, quantized and cached
// the same way the diverging one is.
const intensityRamps = new Map();

/** Sequential ramp from the neutral sheet to `color` over [0, 1]. */
export function intensityStep(color, t) {
  if (!Number.isFinite(t)) return PALETTE.sheetDeep;
  let ramp = intensityRamps.get(color);
  if (ramp === undefined) {
    const toward = interpolateLab(PALETTE.sheet, color);
    ramp = Array.from({ length: RAMP_STEPS }, (_, index) => toward(index / (RAMP_STEPS - 1)));
    intensityRamps.set(color, ramp);
  }
  return ramp[Math.round(Math.max(0, Math.min(1, t)) * (RAMP_STEPS - 1))];
}
