/**
 * The three things the globe can be made to show, each as a radius per mesh
 * vertex. Pure: no canvas, no React.
 *
 *   relief   signed, from one measure of the pair: the area ratio, the angle
 *            difference, or the difference in how far each sheet has to stretch
 *            — the two wrinkle globes subtracted. Bulges where A is the worse
 *            of the two and sinks where B is, on one globe.
 *   wrinkle  unsigned, per map. Where a sheet must be compressed to lie on the
 *            globe it sheds the excess out of plane, so it ruffles.
 *   arcs     no displacement; the sphere stays a sphere and the difference is
 *            drawn on it.
 */

import { distortion } from './distortion.js';

const RADIANS = Math.PI / 180;

// The Tissot semi-axes come from sqrt(h^2 + k^2 - 2hk*sin(theta)), which cancels
// catastrophically where a projection is conformal and leaves `a` about 1e-7
// above 1 at a point that is in fact exactly taut. Anything under this is
// arithmetic, not strain; the fold it would produce is 1e-4 of a radius.
const STRAIN_FLOOR = 1e-6;

// A single sinusoid can only stand in for a fold that has not yet folded over.
// Past about this slope real cloth answers more strain by folding finer rather
// than deeper, and one carrier just turns into spikes the mesh cannot resolve,
// so the amplitude is held to a slope instead of following sqrt(e) forever.
export const MAX_SLOPE = 2.2;

/**
 * Measures both projections at every mesh vertex. This is the expensive step —
 * two Jacobians per vertex — so it is computed once per pair and reused for
 * every camera angle.
 */
export function globeField(mesh, rawA, rawB, maxLat) {
  const { count } = mesh;
  const a = sheetField(mesh, rawA, maxLat);
  const b = sheetField(mesh, rawB, maxLat);

  const arealRatio = new Float64Array(count).fill(NaN);
  const angularDelta = new Float64Array(count).fill(NaN);
  const strainDelta = new Float64Array(count).fill(NaN);
  const defined = new Uint8Array(count);

  for (let n = 0; n < count; n++) {
    if (!a.defined[n] || !b.defined[n]) continue;
    defined[n] = 1;
    arealRatio[n] = Math.log2(a.areal[n] / b.areal[n]);
    angularDelta[n] = a.angular[n] - b.angular[n];
    strainDelta[n] = a.excess[n] - b.excess[n];
  }

  capPoles(mesh, arealRatio, defined);
  capPoles(mesh, angularDelta, defined);
  capPoles(mesh, strainDelta, defined);
  return {
    arealRatio,
    angularDelta,
    strainDelta,
    excessA: a.excess,
    excessB: b.excess,
    thetaA: a.theta,
    thetaB: b.theta,
    anisoA: a.aniso,
    anisoB: b.aniso,
    defined,
  };
}

/**
 * One projection measured at every mesh vertex. `globeField` runs it twice and
 * subtracts; the cloth layer runs it once, because a sheet being draped has no
 * opinion about what it is being compared against, and reads `meridian` and
 * `parallel` rather than the Tissot axes because those are the directions its
 * own mesh edges run in.
 */
export function sheetField(mesh, raw, maxLat) {
  const { count, lon, lat } = mesh;
  const areal = new Float64Array(count);
  const angular = new Float64Array(count);
  const meridian = new Float64Array(count);
  const parallel = new Float64Array(count);
  const excess = new Float64Array(count);
  const theta = new Float64Array(count);
  const aniso = new Float64Array(count);
  const defined = new Uint8Array(count);

  for (let n = 0; n < count; n++) {
    if (Math.abs(lat[n]) > maxLat) continue;
    const local = distortion(raw, lon[n] * RADIANS, lat[n] * RADIANS);
    if (!local) continue;

    defined[n] = 1;
    areal[n] = local.areal;
    angular[n] = local.angular;
    meridian[n] = local.h;
    parallel[n] = local.k;
    excess[n] = Math.max(local.a - 1 - STRAIN_FLOOR, 0);
    theta[n] = local.theta;
    aniso[n] = (local.a - local.b) / (local.a + local.b);
  }
  return { areal, angular, meridian, parallel, excess, theta, aniso, defined };
}

/**
 * Past the compared domain there is nothing to measure, but leaving those
 * vertices undisplaced opens a hole straight through a globe whose surface has
 * moved. Each end is closed with the mean of the nearest measured row: constant
 * around the parallel, so the cap meets itself at the pole instead of tearing.
 * They stay outside `defined`, so the renderer still greys them out.
 */
function capPoles(mesh, values, defined) {
  const { columns, rows } = mesh;
  const stride = columns + 1;

  const rowMean = (j) => {
    let total = 0;
    let seen = 0;
    for (let i = 0; i <= columns; i++) {
      const n = j * stride + i;
      if (defined[n] && Number.isFinite(values[n])) {
        total += values[n];
        seen++;
      }
    }
    return seen ? total / seen : null;
  };

  const fillTo = (from, to, step) => {
    let edge = null;
    for (let j = from; j !== to + step; j += step) {
      const mean = rowMean(j);
      if (mean !== null) {
        edge = mean;
        break;
      }
    }
    if (edge === null) return;
    for (let j = from; j !== to + step; j += step) {
      if (rowMean(j) !== null) return;
      for (let i = 0; i <= columns; i++) values[j * stride + i] = edge;
    }
  };

  fillTo(0, rows, 1);
  fillTo(rows, 0, -1);
}

/**
 * Signed relief from one per-vertex measure — the area ratio or the angle
 * difference. `range` is the same robust cap the matching flat map uses, so the
 * two views cannot disagree about which way a place leans, and `amplitude` is
 * plain vertical exaggeration.
 */
export function reliefRadii(mesh, values, { range, amplitude }) {
  const radii = new Float64Array(mesh.count).fill(1);
  for (let n = 0; n < mesh.count; n++) {
    if (!Number.isFinite(values[n])) continue;
    const t = Math.max(-1, Math.min(1, values[n] / range));
    radii[n] = 1 + amplitude * t;
  }
  return radii;
}

/**
 * Buckling of one map's sheet against the globe.
 *
 * A sheet whose longest axis is a factor `a` too long sheds strain e = a - 1
 * out of plane. A sinusoid of wavelength L and amplitude A has arc length
 * L(1 + pi^2 A^2 / L^2), so absorbing e needs A = (L/pi) * sqrt(e). Crests run
 * across the major axis, which is why Greenland ruffles along its meridians
 * rather than crumpling at random.
 *
 * Where the axes are nearly equal the excess has no preferred direction, so
 * those places take an egg-carton of two perpendicular carriers and crinkle
 * like a leaf edge instead. Their product, not their sum: summing peaks at
 * sqrt(2) and would overshoot the amplitude the law just derived. Conformal
 * maps are isotropic everywhere, so Mercator crinkles where an equal-area map
 * ruffles.
 */
export function wrinkleRadii(mesh, field, side, wavelength) {
  const excess = side === 'a' ? field.excessA : field.excessB;
  const theta = side === 'a' ? field.thetaA : field.thetaB;
  const aniso = side === 'a' ? field.anisoA : field.anisoB;
  const { defined } = field;

  const radii = new Float64Array(mesh.count).fill(1);
  const northFrequency = (2 * Math.PI) / wavelength;

  for (let n = 0; n < mesh.count; n++) {
    if (!defined[n] || excess[n] <= 0) continue;

    const phi = mesh.lat[n] * RADIANS;
    const lambda = mesh.lon[n] * RADIANS;
    const { folds, effective } = foldGeometry(mesh.lat[n], wavelength, theta[n]);

    const east = folds * lambda;
    const north = northFrequency * phi;
    const ruffle = Math.min(1, aniso[n] / 0.08);
    // Crossfade two carriers rather than steering one. A phase built as
    // cos(theta)*east + sin(theta)*north only has its gradient along the major
    // axis while theta is constant; on any pseudocylindrical map theta turns
    // with longitude, the gradient stops following the axis, and the folds come
    // out as ripples spreading from the centre of the map. Each of these two
    // carriers is separately a true phase, and cos^2 + sin^2 = 1 keeps the peak
    // at the amplitude the law asked for.
    const eastward = Math.cos(theta[n]) ** 2;
    const along = eastward * Math.cos(east) + (1 - eastward) * Math.cos(north);
    const crinkle = Math.sin(east) * Math.sin(north);

    radii[n] = 1 + amplitudeFor(excess[n], effective) * (ruffle * along + (1 - ruffle) * crinkle);
  }
  return radii;
}

/**
 * How the folds are laid out at a given latitude.
 *
 * The count is fixed for the whole globe rather than chosen per parallel: a
 * whole number of folds has to close around a parallel or the antimeridian
 * shows a seam, and re-rounding that number latitude by latitude jumps the
 * phase and draws contour rings that are pure arithmetic. Holding it constant
 * makes the folds run pole to pole and crowd together as the parallels shorten,
 * which is what gathered material does, and takes the fold spacing to nothing
 * at the pole instead of leaving a spike.
 */
export function foldGeometry(latDegrees, wavelength, theta) {
  const folds = Math.max(1, Math.round((2 * Math.PI) / wavelength));
  const alongParallel = (2 * Math.PI * Math.cos(latDegrees * RADIANS)) / folds;
  const eastward = Math.cos(theta) ** 2;
  const effective = eastward * alongParallel + (1 - eastward) * wavelength;
  return { folds, effective };
}

/** The arc-length law, held to a slope past which material would fold over. */
export function amplitudeFor(excess, effectiveWavelength) {
  return Math.min(
    (effectiveWavelength / Math.PI) * Math.sqrt(excess),
    (MAX_SLOPE * effectiveWavelength) / (2 * Math.PI),
  );
}

/** Deepest fold and the strain behind it, for the legend. */
export function peakAmplitude(mesh, field, side, wavelength) {
  const excess = side === 'a' ? field.excessA : field.excessB;
  let worst = 0;
  for (let n = 0; n < mesh.count; n++) {
    if (field.defined[n]) worst = Math.max(worst, excess[n]);
  }
  return { depth: amplitudeFor(worst, wavelength), strain: worst };
}
