import { geoProjection } from 'd3-geo';
import { lookup } from './catalog.js';
import { areaNormalization, distortion, interpolateRaw, scaleRaw } from './distortion.js';

const RADIANS = Math.PI / 180;

// Caches the wrapped projection, not just the scale factor: consumers memoize
// on the identity of `rawA` and `rawB`, and a fresh wrapper per call would
// silently invalidate every one of them on each redraw.
const normalizationCache = new Map();

function normalizedRaw(entry, maxLat) {
  const key = `${entry.id}@${maxLat}`;
  let scaled = normalizationCache.get(key);
  if (!scaled) {
    scaled = scaleRaw(entry.raw, areaNormalization(entry.raw, { maxLat }));
    normalizationCache.set(key, scaled);
  }
  return scaled;
}

/**
 * Resolves the pair of projections being compared into everything downstream
 * needs: area-normalized raws for the distortion math, and d3 projections fitted
 * to a shared box so that a displacement between them is a real difference in
 * shape rather than a difference in framing.
 */
export function buildPair({ idA, idB, width, height, rotate = 0, padding = 24 }) {
  const entryA = lookup(idA);
  const entryB = lookup(idB);
  const maxLat = Math.min(entryA.maxLat ?? 89, entryB.maxLat ?? 89);

  const rawA = normalizedRaw(entryA, maxLat);
  const rawB = normalizedRaw(entryB, maxLat);
  const domain = clippedSphere(maxLat);
  const extent = [
    [padding, padding],
    [width - padding, height - padding],
  ];

  const fit = (raw) =>
    geoProjection(raw).rotate([rotate, 0]).precision(0.2).fitExtent(extent, domain);

  return {
    entryA,
    entryB,
    rawA,
    rawB,
    maxLat,
    domain,
    projA: fit(rawA),
    projB: fit(rawB),
    morph: (t) => fit(interpolateRaw(rawA, rawB, t)),
  };
}

/** GeoJSON polygon covering the world down to +/- maxLat. */
export function clippedSphere(maxLat, step = 2) {
  const ring = [];
  for (let lon = -180; lon <= 180; lon += step) ring.push([lon, maxLat]);
  for (let lon = 180; lon >= -180; lon -= step) ring.push([lon, -maxLat]);
  ring.push([-180, maxLat]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Samples both projections on a lon/lat lattice and records, per node, where the
 * point lands on each map and how each one deforms the ground around it.
 *
 * `cells` are quads in projection A's plane, so the heat maps read as "here is
 * where, on map A, the two disagree".
 */
export function sampleField(pair, { columns = 72, rows = 36 } = {}) {
  const { rawA, rawB, projA, projB, maxLat, entryA, entryB } = pair;
  const nodes = [];

  for (let j = 0; j <= rows; j++) {
    const lat = maxLat - (2 * maxLat * j) / rows;
    for (let i = 0; i <= columns; i++) {
      const lon = -180 + (360 * i) / columns;
      const lambda = lon * RADIANS;
      const phi = lat * RADIANS;

      const localA = distortion(rawA, lambda, phi);
      const localB = distortion(rawB, lambda, phi);
      const pointA = projA([lon, lat]);
      const pointB = projB([lon, lat]);

      nodes.push({
        lon,
        lat,
        localA,
        localB,
        ax: pointA?.[0],
        ay: pointA?.[1],
        bx: pointB?.[0],
        by: pointB?.[1],
        displacement:
          pointA && pointB ? Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]) : null,
        arealRatio: localA && localB ? Math.log2(localA.areal / localB.areal) : null,
        angularDelta: localA && localB ? localA.angular - localB.angular : null,
      });
    }
  }

  const cells = [];
  const at = (i, j) => nodes[j * (columns + 1) + i];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (corners.some((node) => node.ax === undefined || !Number.isFinite(node.ax))) continue;
      const middle = [corners[0], corners[2]];
      cells.push({
        polygon: corners.map((node) => [node.ax, node.ay]),
        arealRatio: mean(middle.map((n) => n.arealRatio)),
        angularDelta: mean(middle.map((n) => n.angularDelta)),
        displacement: mean(middle.map((n) => n.displacement)),
      });
    }
  }

  return { nodes, cells, columns, rows, summary: summarize(nodes, entryA, entryB) };
}

function mean(values) {
  const usable = values.filter((value) => value !== null && Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

/**
 * Area-weighted global scores. Areal error is the RMS of ln(area factor), so a
 * projection that doubles some regions and halves others scores the same either
 * way; angular error is the RMS of the maximum angular deformation.
 */
function summarize(nodes, entryA, entryB) {
  const side = (key) => {
    let weight = 0;
    let areal = 0;
    let angular = 0;
    for (const node of nodes) {
      const local = node[key];
      if (!local) continue;
      const w = Math.cos(node.lat * RADIANS);
      weight += w;
      areal += w * Math.log(local.areal) ** 2;
      angular += w * local.angular ** 2;
    }
    if (!weight) return { areal: NaN, angular: NaN };
    return { areal: Math.sqrt(areal / weight), angular: Math.sqrt(angular / weight) };
  };

  const displacements = nodes.map((node) => node.displacement).filter(Number.isFinite);
  displacements.sort((x, y) => x - y);

  return {
    a: { name: entryA.name, ...side('localA') },
    b: { name: entryB.name, ...side('localB') },
    displacement: {
      median: displacements[Math.floor(displacements.length / 2)] ?? NaN,
      p95: displacements[Math.floor(displacements.length * 0.95)] ?? NaN,
      max: displacements[displacements.length - 1] ?? NaN,
    },
  };
}
