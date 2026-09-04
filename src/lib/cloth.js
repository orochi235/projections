/**
 * A map sheet relaxed onto the globe, rather than a fold pattern computed from
 * a law. Pure geometry: no canvas, no React.
 *
 * `relief.js` gives every vertex a fold depth from its own strain and nothing
 * else, so the folds come out as a regular sinusoid that never bunches and
 * never redistributes. That is where this starts — `seedRadii` below — and the
 * relaxation takes it from there: each edge of the mesh carries the length it
 * has on the flat map, the sheet is pressed against the sphere, and the folds
 * are whatever satisfies both. Nothing sets their wavelength directly: adhesion
 * charges for standing off the globe, bending charges for turning sharply, and
 * the fold scale that comes out is the square root of their ratio.
 */

import { amplitudeFor, sheetField } from './relief.js';

const RADIANS = Math.PI / 180;

// The sheet can lie on the globe or stand off it, never sink into it, so all of
// the excess has to go outward — which is also why adhesion alone would answer
// a too-long sheet by inflating the whole sphere. The seed below is what lets
// folding win that argument; a symmetric sheet started flat on the globe has no
// reason to pick one shape over the other and just balloons.
//
// Adhesion is low on purpose. Anything stickier keeps settling long after the
// folds have formed and irons them back out, absorbing the excess as a few
// percent of stretch everywhere instead — the same 5% edge error, with nothing
// left to look at.
const ADHESION = 0.006;

// How hard the sheet resists being stretched, against the full strength it
// resists being compressed.
const STRETCH_GIVE = 0.15;

// A sinusoid needs about this many cells to read as a fold rather than as the
// lattice's own zigzag, so the seed is never asked for one finer.
const CELLS_PER_FOLD = 4;

/**
 * Where the sheet starts: the analytic fold pattern, not noise.
 *
 * A relaxation started flat on the globe knows only edge lengths, so it has to
 * discover a fold direction it cannot measure, and it settles for shear. The
 * wrinkle globe computes that direction in closed form. Seeding from it hands
 * the solver a pattern already at the right scale carrying roughly the right
 * amount of material, leaving it only to redistribute.
 *
 * Two differences from `wrinkleRadii`, both because that globe and this one are
 * not looking at the same sheet:
 *
 * - **The excess is the printed sheet's, not the normalized map's.** The
 *   wrinkle globe measures a map scaled so the world covers the sphere's area;
 *   `restLengths` prints this one at the tightest scale that never stretches,
 *   which is `scale` times bigger. Under that scale 96% of Equal Earth is too
 *   long in *both* directions at once, by 190% on average along the parallel —
 *   so the Tissot major axis is not where the material is, it is merely where
 *   the most of it is, and a seed built on `a - 1` is an order of magnitude too
 *   shallow to survive the first pass.
 * - **Along the mesh's axes, not the Tissot ones.** Every constraint the solver
 *   holds is an edge, and its edges run east and south. A carrier per direction,
 *   summed, puts each one's arc length under a fold that varies only along it —
 *   so the seed's material budget is exactly the budget the edge lengths ask
 *   for, rather than a rotated approximation of it.
 *
 * The wavelength is the mesh's, not the wrinkle globe's: the fold scale the
 * relaxation settles on is sqrt(bending/adhesion) cells across, so seeding at
 * anything else asks it to move the folds before it can refine them.
 */
function seedRadii(mesh, raw, maxLat, scale, bending, adhesion) {
  const { columns, rows, count, lat } = mesh;
  const radii = new Float64Array(count).fill(1);
  if (!(scale > 0)) return radii;

  const sheet = sheetField(mesh, raw, maxLat);
  const cells = Math.max(CELLS_PER_FOLD, Math.sqrt(bending / adhesion));
  const eastFolds = Math.max(1, Math.min(Math.round(columns / cells), Math.floor(columns / CELLS_PER_FOLD)));
  const northFolds = Math.max(1, Math.min(Math.round(rows / cells), Math.floor(rows / CELLS_PER_FOLD)));
  const northLength = Math.PI / northFolds;

  for (let n = 0; n < count; n++) {
    if (!sheet.defined[n]) continue;
    const phi = lat[n] * RADIANS;
    const lambda = mesh.lon[n] * RADIANS;

    // Folds are a fixed count around the globe, so they crowd together as the
    // parallels shorten and the material each one has to absorb shrinks with
    // them — which is what gathered cloth does, and what keeps the seam closed.
    const eastLength = (2 * Math.PI * Math.cos(phi)) / eastFolds;
    const east = amplitudeFor(Math.max(scale * sheet.parallel[n] - 1, 0), eastLength);
    const north = amplitudeFor(Math.max(scale * sheet.meridian[n] - 1, 0), northLength);

    radii[n] = 1 + east * Math.cos(eastFolds * lambda) + north * Math.cos(2 * northFolds * phi);
  }
  return radii;
}

/**
 * Edge rest lengths, read off the flat map and then scaled as a sheet.
 *
 * The printed size of a map is a choice, and the wrong one shows up as the
 * whole sheet being stretched over a globe too big for it — a normalization
 * that equalises total area does exactly that to Mercator, whose equator is
 * shrunk to pay for its poles. So the sheet is sized to the tightest scale that
 * never has to stretch anywhere: one edge ends up exactly taut and every other
 * has material to shed. Nothing downstream then depends on how the projection
 * happened to be normalized.
 */
function restLengths(mesh, raw, maxLat) {
  const { columns, rows, count, lon, lat } = mesh;
  const stride = columns + 1;
  const mx = new Float64Array(count);
  const my = new Float64Array(count);
  const live = new Uint8Array(count);

  for (let n = 0; n < count; n++) {
    if (Math.abs(lat[n]) > maxLat) continue;
    const point = raw(lon[n] * RADIANS, lat[n] * RADIANS);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    mx[n] = point[0];
    my[n] = point[1];
    live[n] = 1;
  }

  const east = new Float64Array((rows + 1) * columns);
  const south = new Float64Array(rows * stride);
  const down = new Float64Array(rows * columns);
  const up = new Float64Array(rows * columns);
  const { ux, uy, uz } = mesh;
  const chord = (a, b) => Math.hypot(ux[b] - ux[a], uy[b] - uy[a], uz[b] - uz[a]);

  let scale = 0;
  const measure = (a, b) => {
    if (!live[a] || !live[b]) return 0;
    const flat = Math.hypot(mx[b] - mx[a], my[b] - my[a]);
    if (flat > 0) scale = Math.max(scale, chord(a, b) / flat);
    return flat;
  };

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < columns; i++) {
      const n = j * stride + i;
      east[j * columns + i] = measure(n, n + 1);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < stride; i++) {
      const n = j * stride + i;
      south[j * stride + i] = measure(n, n + stride);
    }
  }
  // Both diagonals of every cell. Without them the lattice can shear for free —
  // a square slides into a rhombus with all four sides intact — and a sheet
  // stretched one way and squeezed the other, which is every equal-area map,
  // takes that path instead of folding. It reads as shattered glass.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const n = j * stride + i;
      down[j * columns + i] = measure(n, n + stride + 1);
      up[j * columns + i] = measure(n + 1, n + stride);
    }
  }
  if (scale > 0) {
    for (const lengths of [east, south, down, up]) {
      for (let e = 0; e < lengths.length; e++) lengths[e] *= scale;
    }
  }
  return { east, south, down, up, live, scale };
}

/**
 * Relaxes one map's sheet onto the sphere and returns the vertex positions.
 *
 * The relaxation is run to a budget and then stopped, because it does not come
 * to rest on its own: adhesion and the edge lengths cannot both be satisfied on
 * a sheet that is too long one way and too short the other, so past the point
 * where the folds have formed the solver cycles between answers rather than
 * settling. Winding the corrections down instead buys that stillness by giving
 * up the edge lengths — the sheet slumps back toward the sphere and the fold
 * pattern goes with it.
 *
 * Gauss-Seidel over three constraints per pass — hold each edge at its rest
 * length, pull the sheet back toward the globe, resist sharp turns — with the
 * seam and the poles stitched afterwards so the surface stays closed. Position
 * based: no velocities, because the settled shape is the whole answer and the
 * path there is not interesting.
 */
export function createDrape(mesh, raw, maxLat, { bending = 0.3, adhesion = ADHESION } = {}) {
  const { columns, rows, count, ux, uy, uz } = mesh;
  const stride = columns + 1;
  const { east, south, down, up, live, scale } = restLengths(mesh, raw, maxLat);

  const seed = seedRadii(mesh, raw, maxLat, scale, bending, adhesion);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  for (let n = 0; n < count; n++) {
    const r = live[n] ? seed[n] : 1;
    x[n] = ux[n] * r;
    y[n] = uy[n] * r;
    z[n] = uz[n] * r;
  }

  // Previous positions, to report how much the sheet is still moving.
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const dz = new Float64Array(count);
  // Offset from the sphere, rebuilt each pass for the bending term.
  const ox = new Float64Array(count);
  const oy = new Float64Array(count);
  const oz = new Float64Array(count);

  const hold = (a, b, rest) => {
    if (!rest || !live[a] || !live[b]) return;
    const ex = x[b] - x[a];
    const ey = y[b] - y[a];
    const ez = z[b] - z[a];
    const length = Math.hypot(ex, ey, ez);
    if (length < 1e-9) return;
    // Too much material folds; too little has to stretch, and cloth gives a
    // little rather than dragging the weave into knots. Every equal-area map is
    // both at once — a*b = 1 means whatever is too long one way is too short the
    // other — so holding both directions equally hard leaves the sheet with no
    // shape that satisfies it.
    const give = length > rest ? STRETCH_GIVE : 1;
    const push = (give * (length - rest)) / length / 2;
    x[a] += ex * push;
    y[a] += ey * push;
    z[a] += ez * push;
    x[b] -= ex * push;
    y[b] -= ey * push;
    z[b] -= ez * push;
  };

  const settle = (passes) => {
    let motion = 0;
    for (let pass = 0; pass < passes; pass++) {
      motion = onePass();
    }
    capPoles(mesh, x, y, z, live);
    return motion;
  };

  /** One Gauss-Seidel sweep. Returns how far the busiest vertex moved, which is
   *  how the caller knows the sheet has stopped changing shape. */
  function onePass() {
    for (let n = 0; n < count; n++) {
      dx[n] = x[n];
      dy[n] = y[n];
      dz[n] = z[n];
    }

    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i < columns; i++) hold(j * stride + i, j * stride + i + 1, east[j * columns + i]);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i <= columns; i++) hold(j * stride + i, j * stride + i + stride, south[j * stride + i]);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const n = j * stride + i;
        hold(n, n + stride + 1, down[j * columns + i]);
        hold(n + 1, n + stride, up[j * columns + i]);
      }
    }

    // Adhesion: the globe is what the sheet is being laid on, so every vertex
    // is drawn back toward radius 1, and none is allowed inside it.
    for (let n = 0; n < count; n++) {
      if (!live[n]) continue;
      const r = Math.hypot(x[n], y[n], z[n]);
      if (r < 1e-9) continue;
      const pull = r < 1 ? 1 : adhesion;
      const scale = 1 + pull * (1 / r - 1);
      x[n] *= scale;
      y[n] *= scale;
      z[n] *= scale;
    }

    // Bending, applied to the offset from the sphere rather than the position:
    // smoothing the position itself would shrink the sheet and undo the edge
    // lengths that are the whole point. Too little of it and the sheet answers
    // its excess with the shortest fold the lattice can hold — every other cell
    // up, its neighbours down — which is a property of the mesh rather than of
    // the map, and looks like static.
    if (bending > 0) {
      for (let n = 0; n < count; n++) {
        ox[n] = x[n] - ux[n];
        oy[n] = y[n] - uy[n];
        oz[n] = z[n] - uz[n];
      }
      for (let j = 1; j < rows; j++) {
        for (let i = 1; i < columns; i++) {
          const n = j * stride + i;
          if (!live[n]) continue;
          const mean = (a, k) => (a[k - 1] + a[k + 1] + a[k - stride] + a[k + stride]) / 4;
          x[n] += bending * (mean(ox, n) - ox[n]);
          y[n] += bending * (mean(oy, n) - oy[n]);
          z[n] += bending * (mean(oz, n) - oz[n]);
        }
      }
    }

    stitch(mesh, x, y, z);

    let motion = 0;
    for (let n = 0; n < count; n++) {
      motion = Math.max(motion, Math.abs(x[n] - dx[n]) + Math.abs(y[n] - dy[n]) + Math.abs(z[n] - dz[n]));
    }
    return motion;
  }

  return { points: { x, y, z }, live, settle };
}

/** The whole relaxation at once, for tests and for anything not on a clock. */
export function drapeSheet(mesh, raw, maxLat, { iterations = 300, ...rest } = {}) {
  const drape = createDrape(mesh, raw, maxLat, rest);
  drape.settle(iterations);
  return drape.points;
}

/**
 * The lattice names the antimeridian twice, once at each end of every row. Left
 * to drift apart the two copies open a slit down the globe, so they are averaged
 * back together after every pass.
 */
function stitch(mesh, x, y, z) {
  const { columns, rows } = mesh;
  const stride = columns + 1;
  for (let j = 0; j <= rows; j++) {
    const west = j * stride;
    const east = west + columns;
    for (const axis of [x, y, z]) {
      const mean = (axis[west] + axis[east]) / 2;
      axis[west] = mean;
      axis[east] = mean;
    }
  }
}

/**
 * Both pole rows are a single point on the globe written out `columns + 1`
 * times, and a map with a pole line puts real material along them. Rather than
 * let one vertex's worth of that tear the cap open, each pole row is collapsed
 * to the mean ring of the nearest solved row.
 */
function capPoles(mesh, x, y, z, live) {
  const { columns, rows } = mesh;
  const stride = columns + 1;

  const collapse = (from, to) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let seen = 0;
    for (let i = 0; i < columns; i++) {
      const n = from * stride + i;
      if (!live[n]) continue;
      cx += x[n];
      cy += y[n];
      cz += z[n];
      seen++;
    }
    if (!seen) return;
    const r = Math.hypot(cx / seen, cy / seen, cz / seen);
    for (let i = 0; i <= columns; i++) {
      const n = to * stride + i;
      x[n] = mesh.ux[n] * r;
      y[n] = mesh.uy[n] * r;
      z[n] = mesh.uz[n] * r;
    }
  };

  collapse(1, 0);
  collapse(rows - 1, rows);
}

/**
 * How far the settled sheet ended up from the globe, per vertex. This is the
 * simulation's own answer to the question the analytic wrinkle layer computes
 * in closed form, so the two can be compared.
 */
export function standoff(mesh, points) {
  const out = new Float64Array(mesh.count);
  for (let n = 0; n < mesh.count; n++) {
    out[n] = Math.hypot(points.x[n], points.y[n], points.z[n]) - 1;
  }
  return out;
}

/**
 * How far the settled edges ended up from the lengths the map gave them, as a
 * fraction. Cloth is nearly inextensible, so this is the model's own honesty
 * check: what it cannot fold away it has to stretch, and a mesh too coarse to
 * resolve a fold shows up here rather than quietly looking fine.
 */
export function edgeError(mesh, raw, maxLat, points) {
  const { columns, rows } = mesh;
  const stride = columns + 1;
  const { east, south, live } = restLengths(mesh, raw, maxLat);

  let total = 0;
  let worst = 0;
  let seen = 0;
  const compare = (a, b, rest) => {
    if (!rest || !live[a] || !live[b]) return;
    const got = Math.hypot(points.x[b] - points.x[a], points.y[b] - points.y[a], points.z[b] - points.z[a]);
    const error = Math.abs(got - rest) / rest;
    total += error;
    worst = Math.max(worst, error);
    seen++;
  };

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < columns; i++) compare(j * stride + i, j * stride + i + 1, east[j * columns + i]);
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < stride; i++) compare(j * stride + i, j * stride + i + stride, south[j * stride + i]);
  }
  return { mean: seen ? total / seen : 0, worst };
}
