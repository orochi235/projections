const EPS = 1e-5; // radians; near the sweet spot for central differences in f64
const DEGREES = 180 / Math.PI;

/**
 * One axis of the Jacobian, taken as the mean of the two one-sided differences
 * so that they can be compared first. Where a projection is differentiable the
 * two agree to within rounding error; where it is not, they disagree outright,
 * and the value a plain central difference would report is an artefact of
 * stepping across a jump. The case that matters is the antipode of an azimuthal
 * projection, where a single point on the globe becomes the whole rim of the
 * disc: d3 returns a finite coordinate there, but no derivative exists.
 */
function axisDerivative(centre, before, after, step) {
  const back = [(centre[0] - before[0]) / step, (centre[1] - before[1]) / step];
  const forward = [(after[0] - centre[0]) / step, (after[1] - centre[1]) / step];
  const magnitude = Math.max(Math.hypot(back[0], back[1]), Math.hypot(forward[0], forward[1]));
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  const mismatch = Math.hypot(forward[0] - back[0], forward[1] - back[1]) / magnitude;
  if (mismatch > 0.5) return null;
  return [(back[0] + forward[0]) / 2, (back[1] + forward[1]) / 2];
}

/**
 * Jacobian of a raw projection at (lambda, phi): radians in, unit-sphere plane
 * coordinates out. Null where the projection is not differentiable.
 */
export function jacobian(raw, lambda, phi) {
  const centre = raw(lambda, phi);
  if (!centre || !Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return null;

  const alongParallel = axisDerivative(centre, raw(lambda - EPS, phi), raw(lambda + EPS, phi), EPS);
  const alongMeridian = axisDerivative(centre, raw(lambda, phi - EPS), raw(lambda, phi + EPS), EPS);
  if (!alongParallel || !alongMeridian) return null;

  return { xl: alongParallel[0], yl: alongParallel[1], xp: alongMeridian[0], yp: alongMeridian[1] };
}

/**
 * Local distortion at a point, in Snyder's terms.
 *
 *   h        scale along the meridian
 *   k        scale along the parallel
 *   a, b     semi-axes of the Tissot indicatrix, a >= b
 *   areal    area scale factor, equal to a * b
 *   angular  maximum angular deformation, in degrees
 *
 * Null at the poles and anywhere the projection is singular.
 */
export function distortion(raw, lambda, phi) {
  const cosPhi = Math.cos(phi);
  if (cosPhi < 1e-7) return null;

  const derivatives = jacobian(raw, lambda, phi);
  if (!derivatives) return null;
  const { xl, yl, xp, yp } = derivatives;

  const h = Math.hypot(xp, yp);
  const k = Math.hypot(xl, yl) / cosPhi;
  const areal = Math.abs(xl * yp - xp * yl) / cosPhi;
  if (!Number.isFinite(h) || !Number.isFinite(k) || !Number.isFinite(areal)) return null;
  if (h < 1e-9 || k < 1e-9) return null;

  // areal = h * k * sin(theta'), where theta' is the projected angle between the
  // meridian and the parallel.
  const sinTheta = Math.min(1, areal / (h * k));
  const sum = Math.sqrt(Math.max(0, h * h + k * k + 2 * h * k * sinTheta));
  const diff = Math.sqrt(Math.max(0, h * h + k * k - 2 * h * k * sinTheta));
  const a = (sum + diff) / 2;
  const b = (sum - diff) / 2;
  const angular = 2 * Math.asin(Math.min(1, (a - b) / (a + b))) * DEGREES;

  return { h, k, a, b, areal, angular };
}

/**
 * Raw projections come out of d3 at whatever plane scale their author chose, so
 * two of them are not area-comparable as shipped. This finds the factor s where
 * scaling the plane output by s makes the projected world cover the same area as
 * the unit sphere — after which an equal-area projection reads exactly 1.0
 * everywhere, and any other reading is a real distortion rather than a units
 * artefact.
 */
export function areaNormalization(raw, { maxLat = 89, steps = 180 } = {}) {
  const phiMax = maxLat * (Math.PI / 180);
  const dLambda = (2 * Math.PI) / steps;
  const dPhi = (2 * phiMax) / steps;

  let planeArea = 0;
  let sphereArea = 0;
  for (let i = 0; i < steps; i++) {
    const phi = -phiMax + (i + 0.5) * dPhi;
    const cosPhi = Math.cos(phi);
    for (let j = 0; j < steps; j++) {
      const lambda = -Math.PI + (j + 0.5) * dLambda;
      const local = distortion(raw, lambda, phi);
      if (!local) continue;
      planeArea += local.areal * cosPhi * dPhi * dLambda;
      sphereArea += cosPhi * dPhi * dLambda;
    }
  }
  if (planeArea <= 0) return 1;
  return Math.sqrt(sphereArea / planeArea);
}

/** Wraps a raw projection so its plane output is multiplied by `scale`. */
export function scaleRaw(raw, scale) {
  const scaled = (lambda, phi) => {
    const [x, y] = raw(lambda, phi);
    return [x * scale, y * scale];
  };
  if (raw.invert) {
    scaled.invert = (x, y) => raw.invert(x / scale, y / scale);
  }
  return scaled;
}

/**
 * Straight-line blend between two raw projections. Both should already be
 * area-normalized, otherwise the morph mostly animates a change of size.
 */
export function interpolateRaw(rawA, rawB, t) {
  return (lambda, phi) => {
    const [xa, ya] = rawA(lambda, phi);
    const [xb, yb] = rawB(lambda, phi);
    return [xa + t * (xb - xa), ya + t * (yb - ya)];
  };
}
