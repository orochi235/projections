/**
 * One window on the globe, meshed finely enough to see individual folds.
 *
 * The whole-globe views hold a fold every dozen degrees, which shows that a map
 * ruffles and not what decides the ruffle. A patch is a few tens of degrees
 * across at several times that fold count, so the crossfades and the zeroes in
 * the buckling law become things you can point at. Pure geometry: no canvas, no
 * React.
 */

import { camera } from './globe.js';

const RADIANS = Math.PI / 180;

// Looking straight down at a patch shows the folds only by their shading. A
// little tilt puts the near edge in profile, which is what makes them read as
// depth rather than as stripes. The globe's own tilt is added to this, so
// dragging turns the patch the same way it turns everything else.
export const PATCH_TILT = 0.2;

// A sinusoid needs a handful of cells to read as a fold, so the mesh has to be
// this much finer than the fold count the caller asks for.
const CELLS_PER_FOLD = 12;

/**
 * The places worth looking at, and what each one is supposed to show. `why` is
 * the claim the picture has to support; if a render stops showing it, one of
 * the two is wrong.
 *
 * Each names the projection it means something on — an isocol is a property of
 * one map, not of the globe — so choosing a site chooses that map too.
 */
export const PATCH_SITES = [
  {
    id: 'isocol',
    projection: 'mollweide',
    title: 'Mollweide’s isocol',
    at: [0, 40.73],
    span: 56,
    exaggerate: 2.5,
    why: 'At 40°44′N on the central meridian a = b: the only place on this half of the map where the excess has no direction to fold across. The ruffle hands over to an egg-carton here and hands back on the way out.',
  },
  {
    id: 'standard',
    projection: 'gallPeters',
    title: 'Gall–Peters’ standard parallel',
    at: [0, 45],
    span: 34,
    why: 'a = b = 1 along the whole of 45°N: the sheet is exactly taut, so fold depth passes through zero rather than near it. An ironed band with ruffle above and below.',
  },
  {
    id: 'crushed',
    projection: 'equalEarth',
    title: 'Equal Earth’s crushed corner',
    at: [180, 80],
    span: 16,
    why: 'The minor axis bottoms out at b = 0.25 by 83°N on the antimeridian — the vertex that decides how big the cloth sheet has to be printed, and so how baggy the rest of it is. The parallels are short enough here that the excess goes into more folds rather than deeper ones.',
  },
  {
    id: 'handover',
    projection: 'sinusoidal',
    title: 'Sinusoidal’s turning axis',
    at: [60, 45],
    series: [0, 60, 120],
    span: 26,
    why: 'The Tissot major axis swings 117° off east on the way out to the limb. The model answers by fading between a carrier that runs along the parallels and one that runs along the meridians, so the folds never rotate — they hand over.',
  },
];

export function siteFor(id) {
  return PATCH_SITES.find((site) => site.id === id) ?? PATCH_SITES[0];
}

/** How fine a mesh a given number of folds across the patch needs. */
export function patchColumns(folds) {
  return Math.round(folds * CELLS_PER_FOLD);
}

/** Fold wavelength in radians, from the number wanted across the patch. */
export function patchWavelength(span, folds) {
  return (span * RADIANS) / folds;
}

/**
 * A lattice over one window, shaped exactly like `sphereMesh`'s so everything
 * downstream takes it unchanged. The longitude span is widened by 1/cos(lat) so
 * the patch covers roughly square ground rather than a sliver — capped, because
 * 1/cos runs away near the pole where a square patch wraps most of the way
 * around the world and stops being a patch.
 */
export function patchMesh([centreLon, centreLat], span, columns) {
  const rows = columns;
  const halfLat = span / 2;
  const halfLon = Math.min(40, halfLat / Math.cos(centreLat * RADIANS));
  const count = (columns + 1) * (rows + 1);
  const lon = new Float64Array(count);
  const lat = new Float64Array(count);
  const ux = new Float64Array(count);
  const uy = new Float64Array(count);
  const uz = new Float64Array(count);

  // A patch that would run past a pole is not a window on the globe; sliding it
  // back keeps its size rather than tapering it to a spike.
  const top = Math.min(89, centreLat + halfLat);
  let n = 0;
  for (let j = 0; j <= rows; j++) {
    const latitude = top - (span * j) / rows;
    const phi = latitude * RADIANS;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let i = 0; i <= columns; i++) {
      const longitude = centreLon - halfLon + (2 * halfLon * i) / columns;
      const lambda = longitude * RADIANS;
      lon[n] = longitude;
      lat[n] = latitude;
      ux[n] = cosPhi * Math.sin(lambda);
      uy[n] = sinPhi;
      uz[n] = cosPhi * Math.cos(lambda);
      n++;
    }
  }
  return { columns, rows, count, lon, lat, ux, uy, uz };
}

/** The patch's edge as a closed [lon, lat] ring, for drawing it on a globe. */
export function patchOutline(mesh) {
  const { columns, rows } = mesh;
  const stride = columns + 1;
  const ring = [];
  const push = (n) => ring.push([mesh.lon[n], mesh.lat[n]]);

  for (let i = 0; i <= columns; i++) push(i);
  for (let j = 1; j <= rows; j++) push(j * stride + columns);
  for (let i = columns - 1; i >= 0; i--) push(rows * stride + i);
  for (let j = rows - 1; j >= 0; j--) push(j * stride);
  return ring;
}

/**
 * A camera looking square at the patch, then scaled and placed so the whole of
 * it fills a box `size` across centred on (cx, cy).
 *
 * The globe's own yaw and pitch are added on top of the centring, so a drag
 * turns the patch rather than leaving it pinned while the rest of the view
 * moves. Because the fit is recomputed from the rotated vertices every frame,
 * turning it never walks it out of the panel. The fit is measured over every
 * vertex rather than the corners, because the folds stand off the sphere and
 * the deepest of them is often not on an edge.
 */
export function patchCamera(mesh, radii, { size, cx, cy, yaw = 0, pitch = 0, tilt = PATCH_TILT }) {
  const centre = (mesh.count - 1) / 2;
  const view = {
    yaw: -mesh.lon[centre] * RADIANS + yaw,
    pitch: mesh.lat[centre] * RADIANS + tilt + pitch,
  };
  const probe = camera({ ...view, scale: 1, cx: 0, cy: 0 });

  const point = [0, 0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let n = 0; n < mesh.count; n++) {
    const r = radii ? radii[n] : 1;
    probe.view(mesh.ux[n] * r, mesh.uy[n] * r, mesh.uz[n] * r, point);
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }

  const scale = size / Math.max(maxX - minX, maxY - minY, 1e-9);
  return camera({
    ...view,
    scale,
    cx: cx - ((minX + maxX) / 2) * scale,
    cy: cy + ((minY + maxY) / 2) * scale,
  });
}

/**
 * `locator` for a window rather than a whole globe.
 *
 * The globe-wide one turns a longitude into a column by assuming the lattice
 * spans the world, which on a patch mesh puts every coastline on Earth
 * somewhere inside the window. This one uses the patch's own bounds and reports
 * anything outside them as behind the horizon, which is how `strokeOnSphere`
 * already asks to be told to stop drawing.
 */
export function patchLocator(mesh, radii, cam) {
  const { columns, rows } = mesh;
  const stride = columns + 1;
  const lonMin = mesh.lon[0];
  const lonMax = mesh.lon[columns];
  const latMax = mesh.lat[0];
  const latMin = mesh.lat[mesh.count - 1];
  const point = [0, 0, 0];

  const corner = (p0, fu, fv, axis) =>
    axis[p0] * (1 - fu) * (1 - fv) +
    axis[p0 + 1] * fu * (1 - fv) +
    axis[p0 + stride] * (1 - fu) * fv +
    axis[p0 + stride + 1] * fu * fv;

  return (lon, lat) => {
    if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) return { x: 0, y: 0, z: -1 };
    const u = ((lon - lonMin) / (lonMax - lonMin)) * columns;
    const v = ((latMax - lat) / (latMax - latMin)) * rows;
    const i = Math.min(columns - 1, Math.floor(u));
    const j = Math.min(rows - 1, Math.floor(v));
    const p0 = j * stride + i;
    const r = corner(p0, u - i, v - j, radii);

    const phi = lat * RADIANS;
    const lambda = lon * RADIANS;
    const cosPhi = Math.cos(phi);
    cam.view(cosPhi * Math.sin(lambda) * r, Math.sin(phi) * r, cosPhi * Math.cos(lambda) * r, point);
    return { x: cam.screenX(point[0]), y: cam.screenY(point[1]), z: point[2] };
  };
}
