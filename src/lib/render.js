import { geoEquirectangular, geoGraticule10, geoInterpolate, geoPath } from 'd3-geo';
import { geoVoronoi } from 'd3-geo-voronoi';
import { buildFrame, camera, locator, unitRadii } from './globe.js';
import { patchCamera, patchLocator } from './patch.js';
import { diverging, divergingStep, intensityStep, PALETTE, shadeStep } from './palette.js';

const GRATICULE = geoGraticule10();
const RADIANS = Math.PI / 180;

function clear(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
}

function strokeGeometry(ctx, projection, geometry, { color, width = 1, alpha = 1 }) {
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  path(geometry);
  ctx.stroke();
  ctx.restore();
}

function fillGeometry(ctx, projection, geometry, { color, alpha = 1 }) {
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  path(geometry);
  ctx.fill();
  ctx.restore();
}

// Keyed by the geometry as well as the latitude: land and the Voronoi cells
// both come through here, and one cache slot per limit would hand back the
// wrong shape.
const clampCache = new WeakMap();

/**
 * Land held inside the compared domain.
 *
 * The domain stops at +/-maxLat and the projection is fitted to it, but the
 * coastline is drawn straight through and Antarctica runs to the pole — which
 * Mercator sends to infinity, so it spills past the frame in a shape that
 * changes wildly as the central meridian moves and the antimeridian cut falls
 * somewhere else through the ring. Clamping the latitudes lays the part below
 * the domain along its edge, which is where a map clipped at 84 degrees puts it
 * anyway. It is not a true polygon clip, and does not need to be: no coastline
 * crosses that parallel and comes back.
 */
function withinDomain(land, maxLat) {
  let byLimit = clampCache.get(land);
  if (!byLimit) {
    byLimit = new Map();
    clampCache.set(land, byLimit);
  }
  let held = byLimit.get(maxLat);
  if (held) return held;

  const hold = (position) => [position[0], Math.max(-maxLat, Math.min(maxLat, position[1]))];
  const walk = (input) => {
    if (Array.isArray(input)) return input.length && Array.isArray(input[0]) ? input.map(walk) : hold(input);
    if (input.type === 'FeatureCollection') return { ...input, features: input.features.map(walk) };
    if (input.type === 'Feature') return { ...input, geometry: walk(input.geometry) };
    if (input.type === 'GeometryCollection') return { ...input, geometries: input.geometries.map(walk) };
    return { ...input, coordinates: walk(input.coordinates) };
  };

  held = walk(land);
  byLimit.set(maxLat, held);
  return held;
}

/** Faint land and graticule, used as the substrate under the quantitative modes. */
function drawBase(ctx, projection, land, domain, { landAlpha = 0.5 } = {}) {
  if (land) fillGeometry(ctx, projection, land, { color: PALETTE.land, alpha: landAlpha });
  strokeGeometry(ctx, projection, GRATICULE, { color: PALETTE.hairline, width: 0.5, alpha: 0.7 });
  strokeGeometry(ctx, projection, domain, { color: PALETTE.inkSoft, width: 1, alpha: 0.55 });
}

/**
 * Both projections drawn over each other in their own colour. The oldest trick
 * in the book, and still the fastest way to see gross disagreement.
 */
function renderOutlines(ctx, { pair, land }) {
  const { projA, projB, domain } = pair;
  for (const [projection, color] of [
    [projB, PALETTE.b],
    [projA, PALETTE.a],
  ]) {
    strokeGeometry(ctx, projection, GRATICULE, { color, width: 0.6, alpha: 0.35 });
    strokeGeometry(ctx, projection, domain, { color, width: 1.4, alpha: 0.8 });
    if (land) strokeGeometry(ctx, projection, land, { color, width: 1.1, alpha: 0.9 });
  }
}

/**
 * Where every point of the graticule moves when you swap projections. The stalk
 * runs from its position on the first map to its position on the second, so
 * both length and direction are readable at a glance.
 */
function renderDisplacement(ctx, { pair, field, land }) {
  const { projA, domain } = pair;
  drawBase(ctx, projA, land, domain, { landAlpha: 0.35 });

  const stride = Math.max(1, Math.round(field.columns / 40));
  const longest = field.summary.displacement.max || 1;

  ctx.save();
  ctx.lineCap = 'round';
  for (let j = 0; j <= field.rows; j += stride) {
    for (let i = 0; i <= field.columns; i += stride) {
      const node = field.nodes[j * (field.columns + 1) + i];
      if (!node || !Number.isFinite(node.displacement)) continue;
      const weight = node.displacement / longest;

      ctx.globalAlpha = 0.25 + 0.6 * weight;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 0.6 + 1.8 * weight;
      ctx.beginPath();
      ctx.moveTo(node.ax, node.ay);
      ctx.lineTo(node.bx, node.by);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = PALETTE.a;
      ctx.beginPath();
      ctx.arc(node.ax, node.ay, 1.4, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = PALETTE.b;
      ctx.beginPath();
      ctx.arc(node.bx, node.by, 1.4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Shared quad-mesh fill for the two scalar modes. */
function renderScalar(ctx, { pair, field, land }, { value, range }) {
  const { projA, domain } = pair;

  ctx.save();
  for (const cell of field.cells) {
    const raw = value(cell);
    if (raw === null || !Number.isFinite(raw)) continue;
    const color = diverging(raw / range);
    ctx.fillStyle = color;
    ctx.strokeStyle = color; // closes hairline seams between neighbouring quads
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [first, ...rest] = cell.polygon;
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  if (land) strokeGeometry(ctx, projA, land, { color: PALETTE.ink, width: 0.7, alpha: 0.45 });
  strokeGeometry(ctx, projA, GRATICULE, { color: PALETTE.ink, width: 0.4, alpha: 0.18 });
  strokeGeometry(ctx, projA, domain, { color: PALETTE.ink, width: 1.2, alpha: 0.5 });
}

// Earth's surface, for saying how much of it one stud stands for. Ocean
// included: these are areas of sphere, not of land.
const EARTH_KM2 = 510_072_000;
const EARTH_MI2 = 196_940_000;

const studCache = new Map();

/**
 * Studs, spread evenly by area over the globe rather than by longitude and
 * latitude. Equal surface per dot is the whole point: wherever a map inflates
 * the world the dots thin out and wherever it shrinks it they crowd together,
 * and the morph is that crowding rearranging itself. A lattice would give the
 * same count and add its own moiré; the golden angle spaces them without one.
 */
function studLattice(count) {
  let points = studCache.get(count);
  if (points) return points;

  const golden = Math.PI * (3 - Math.sqrt(5));
  points = [];
  for (let i = 0; i < count; i++) {
    const lat = Math.asin(1 - (2 * (i + 0.5)) / count) * (180 / Math.PI);
    const lon = (((i * golden * (180 / Math.PI)) % 360) + 540) % 360 - 180;
    points.push([lon, lat]);
  }
  studCache.set(count, points);
  return points;
}

/**
 * The surface one stud stands for. Derived from the count rather than written
 * down beside it, so the legend cannot go stale when the count moves. The
 * lattice divides the whole sphere evenly, so this holds for every stud
 * including the ones a clipped map never draws.
 */
export function studArea(count) {
  return { km2: EARTH_KM2 / count, mi2: EARTH_MI2 / count };
}

/** Dot size tracks the surface behind it, so total ink stays put as count moves. */
function studRadius(count) {
  return Math.max(0.7, Math.min(3.5, 1.5 * Math.sqrt(1400 / count)));
}

// Land as a bitmap in plate carree, so a stud can be asked whether it is on
// land in constant time. geoContains answers the same question exactly and
// takes 730ms over 1400 studs, which is a visible stall on a slider drag; a
// raster this size is finer than the 110m coastline it is drawn from.
const MASK_WIDTH = 2048;
const MASK_HEIGHT = 1024;
let landMask = null;

function maskOf(land) {
  if (landMask) return landMask;
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(MASK_WIDTH, MASK_HEIGHT)
      : Object.assign(document.createElement('canvas'), { width: MASK_WIDTH, height: MASK_HEIGHT });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const plate = geoEquirectangular()
    .translate([MASK_WIDTH / 2, MASK_HEIGHT / 2])
    .scale(MASK_WIDTH / (2 * Math.PI));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  geoPath(plate, ctx)(land);
  ctx.fill();
  const { data } = ctx.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT);
  landMask = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  for (let i = 0; i < landMask.length; i++) landMask[i] = data[i * 4] > 127 ? 1 : 0;
  return landMask;
}

const shoreCache = new Map();

/** Which studs stand on land. Fixed for a count, so it is asked for once. */
function studShore(land, count) {
  let shore = shoreCache.get(count);
  if (shore) return shore;
  const mask = maskOf(land);
  shore = new Uint8Array(count);
  studLattice(count).forEach(([lon, lat], index) => {
    const x = Math.min(MASK_WIDTH - 1, Math.max(0, Math.floor(((lon + 180) / 360) * MASK_WIDTH)));
    const y = Math.min(MASK_HEIGHT - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MASK_HEIGHT)));
    shore[index] = mask[y * MASK_WIDTH + x];
  });
  shoreCache.set(count, shore);
  return shore;
}

const cellCache = new Map();

/**
 * Each stud's territory: the Voronoi cells of the lattice, on the sphere.
 *
 * Built on the sphere and then projected, not computed from the projected
 * points. The lattice never moves, so this is paid once per count rather than
 * per frame — and a planar Voronoi of the projected studs would bridge across
 * the antimeridian and leave the cells at the edge unbounded.
 *
 * They come out very close to equal: sampling the sphere against the 1400-stud
 * lattice puts the spread in cell area at 0.6% overall and inside 1% everywhere
 * below 60 degrees, with the drift in the handful of cells capping each pole,
 * where the spiral has no neighbours to interleave with. So a cell that does
 * not look like its neighbours is the map talking, not the lattice.
 */
function studCells(count) {
  let cells = cellCache.get(count);
  if (cells) return cells;
  cells = geoVoronoi(studLattice(count)).polygons();
  cellCache.set(count, cells);
  return cells;
}

/**
 * One cell's ring in screen coordinates, laid out around its own site.
 *
 * A cell straddling the antimeridian projects to two pieces at opposite edges
 * of the map, and joining its vertices in order draws a band across the whole
 * width. Rather than drop those cells — which leaves a column of studs with no
 * tile down each edge — the far vertices are carried back across by one width
 * of map, so the tile stays whole and runs off the edge instead. The width to
 * carry them by is the map's own at that latitude, since a pseudocylindrical
 * map narrows toward the poles and one figure would not do.
 */
function projectRing(projection, ring, site) {
  const anchor = projection(site);
  if (!anchor || !Number.isFinite(anchor[0])) return null;

  // Whether the seam runs through this cell is a question about longitudes, so
  // it is answered before any projecting: only the few cells that say yes pay
  // for the widths below.
  const carried = ring.some(([lon]) => Math.abs(lon - site[0]) > 180);

  // How far one lap of the world is, at each vertex's own latitude. A
  // pseudocylindrical map narrows toward the poles, so one figure taken at the
  // cell's centre carries its top and bottom by the wrong amount and the copy
  // at the far edge lands askew over its neighbours.
  const lap = (lat) => {
    const west = projection([-180, lat]);
    const east = projection([180, lat]);
    return west && east ? Math.abs(east[0] - west[0]) : 0;
  };

  const points = [];
  const periods = [];
  for (const [lon, lat] of ring) {
    const at = projection([lon, lat]);
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    const period = carried ? lap(lat) : 0;
    let x = at[0];
    if (period > 0) {
      while (x - anchor[0] > period / 2) x -= period;
      while (anchor[0] - x > period / 2) x += period;
    }
    points.push([x, at[1]]);
    periods.push(period);
  }
  // The site's own lap, not the first vertex's: the tile is laid out around the
  // site, so a copy whose anchor moves by a different width than its outline
  // lands askew over its neighbours.
  return { points, carried, periods, sitePeriod: carried ? lap(site[1]) : 0 };
}

/** Shoelace area and centroid of a screen-space ring. */
function ringMoments(points) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    twiceArea += cross;
    cx += (points[j][0] + points[i][0]) * cross;
    cy += (points[j][1] + points[i][1]) * cross;
  }
  const area = twiceArea / 2;
  if (Math.abs(area) < 1e-9) return null;
  return { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
}

/**
 * Every cell scaled about its own centre until they all hold the same amount of
 * the map, so what is left to read is the gap between them.
 *
 * Normalized to the smallest cell rather than to the average: anything larger
 * would have to grow, and a tile that grows overlaps its neighbours and stops
 * being a tile. So the tightest place on the map is drawn gapless and every
 * other place is drawn with the room the projection gave it that it did not
 * need. The tile keeps whatever shape the cell had, so its elongation is the
 * angular distortion at the same time.
 */
function drawCells(ctx, projection, cells, { maxLat, shrink: shrinking, anchor, shore, studCount }) {
  const rings = [];
  cells.features.forEach((feature, index) => {
    // The cells capping the poles are held to the domain edge, which leaves
    // them as slivers of almost no area — and one of those setting the floor
    // shrinks every tile on the map to a speck.
    if (Math.abs(feature.properties.site[1]) > maxLat) return;
    const laid = projectRing(projection, feature.geometry.coordinates[0], feature.properties.site);
    if (!laid) return;
    const { points, carried, periods, sitePeriod } = laid;
    const moments = ringMoments(points);
    if (!moments) return;
    // A projection does not send a cell's centroid to its generating point, and
    // the gap between them is how hard it is bending that patch. Hanging the
    // tile on the stud puts the dot dead centre and makes the correspondence
    // plain; leaving it on the centroid keeps that gap on show.
    const site = anchor ? projection(feature.properties.site) : null;
    const tile = {
      points,
      land: shore[index],
      area: moments.area,
      cx: moments.cx,
      cy: moments.cy,
      ax: site && Number.isFinite(site[0]) ? site[0] : moments.cx,
      ay: site && Number.isFinite(site[1]) ? site[1] : moments.cy,
    };
    rings.push(tile);

    // A cell the seam runs through belongs at both edges of the map, because
    // the world wraps and those two pieces are the same cell. Drawing it once
    // and letting it hang off one edge would leave a hole at the other. The
    // copies that land outside are dropped by the clip.
    if (carried) {
      for (const direction of [1, -1]) {
        const shifted = tile.points.map(([x, y], index) => [x + direction * periods[index], y]);
        const moments = ringMoments(shifted);
        if (!moments) continue;
        rings.push({
          ...tile,
          points: shifted,
          cx: moments.cx,
          cy: moments.cy,
          ax: tile.ax + direction * sitePeriod,
          ay: tile.ay,
        });
      }
    }
  });
  if (!rings.length) return;

  // A low percentile rather than the outright minimum, for the same reason: the
  // floor should be the tightest part of the map, not its worst single cell.
  const sorted = rings.map((ring) => ring.area).sort((a, b) => a - b);
  const tightest = sorted[Math.floor(sorted.length * 0.05)];

  // Each cell wears the ground it stands on, so the mosaic is a map: the
  // coastline is the boundary between the two fills rather than a line drawn
  // over them, at whatever resolution the stud count buys.
  ctx.save();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 0.6;
  for (const { points, land, area, cx, cy, ax, ay } of rings) {
    const shrink = shrinking ? Math.min(1, Math.sqrt(tightest / area)) : 1;
    ctx.fillStyle = land ? PALETTE.land : PALETTE.water;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      const px = ax + (x - cx) * shrink;
      const py = ay + (y - cy) * shrink;
      if (index) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  }
  ctx.restore();
}

// Wide enough that the difference is real against f64, narrow enough that the
// projection has not curved appreciably across it.
const DERIVATIVE_STEP = 0.02;

/**
 * The Tissot indicatrix at a point: what a small circle on the globe becomes.
 *
 * The projection is differenced in screen space rather than read off `raw`,
 * because a blended morph has no entry in the catalog to ask and because the
 * ellipse has to be drawn at an angle on the canvas, which a bearing on the
 * globe is not. Columns of the Jacobian are pixels per unit of ground east and
 * north; its singular values are the semi-axes and the left rotation is the
 * angle to draw them at.
 */
export function indicatrix(projection, lon, lat) {
  const cosLat = Math.cos(lat * RADIANS);
  if (cosLat < 1e-4) return null;
  const east0 = projection([lon - DERIVATIVE_STEP, lat]);
  const east1 = projection([lon + DERIVATIVE_STEP, lat]);
  const north0 = projection([lon, lat - DERIVATIVE_STEP]);
  const north1 = projection([lon, lat + DERIVATIVE_STEP]);
  const centre = projection([lon, lat]);
  if (!east0 || !east1 || !north0 || !north1 || !centre) return null;

  const perEast = 1 / (2 * DERIVATIVE_STEP * RADIANS * cosLat);
  const perNorth = 1 / (2 * DERIVATIVE_STEP * RADIANS);
  const a = (east1[0] - east0[0]) * perEast;
  const c = (east1[1] - east0[1]) * perEast;
  const b = (north1[0] - north0[0]) * perNorth;
  const d = (north1[1] - north0[1]) * perNorth;
  if (![a, b, c, d].every(Number.isFinite)) return null;

  const e = (a + d) / 2;
  const f = (a - d) / 2;
  const g = (c + b) / 2;
  const h = (c - b) / 2;
  const q = Math.hypot(e, h);
  const r = Math.hypot(f, g);
  return {
    x: centre[0],
    y: centre[1],
    major: q + r,
    minor: Math.abs(q - r),
    angle: (Math.atan2(h, e) + Math.atan2(g, f)) / 2,
  };
}

// A Tissot field is read one ellipse at a time, so it wants far fewer marks
// than the studs give it.
const INDICATRICES = 120;

/**
 * Tissot indicatrices on a stride through the stud lattice, so they stay spread
 * by area and follow the same slider as everything else.
 *
 * Sized against the median mark rather than a fixed ground radius: the whole
 * field is one scale factor, so the ellipses stay comparable to each other,
 * and no projection can push them off the map or shrink them to nothing.
 */
function drawIndicatrices(ctx, projection, studCount, maxLat) {
  const stride = Math.max(1, Math.round(studCount / INDICATRICES));
  const marks = [];
  const sizes = [];
  for (let i = 0; i < studCount; i += stride) {
    const [lon, lat] = studLattice(studCount)[i];
    if (Math.abs(lat) > maxLat) continue;
    const mark = indicatrix(projection, lon, lat);
    if (!mark || !(mark.major > 0)) continue;
    marks.push(mark);
    sizes.push(Math.sqrt(mark.major * mark.minor));
  }
  if (!marks.length) return;

  sizes.sort((a, b) => a - b);
  const scale = 9 / sizes[Math.floor(sizes.length / 2)];

  ctx.save();
  ctx.strokeStyle = PALETTE.a;
  ctx.fillStyle = PALETTE.a;
  ctx.lineWidth = 0.8;
  for (const { x, y, major, minor, angle } of marks) {
    ctx.beginPath();
    ctx.ellipse(x, y, major * scale, minor * scale, angle, 0, 2 * Math.PI);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.stroke();
  }
  ctx.restore();
}

/** One projection bent into the other. Motion makes small differences obvious. */
function renderMorph(ctx, state) {
  const { pair, land, morphT, morphBare, studCount, morphCells, morphDots, morphTiles, morphTissot, morphAnchor } = state;
  const projection = pair.morph(morphT);
  if (morphBare) {
    strokeGeometry(ctx, projection, pair.domain, { color: PALETTE.hairline, width: 1, alpha: 0.5 });
  } else {
    drawBase(ctx, projection, land, pair.domain, { landAlpha: 0.75 });
    if (land) strokeGeometry(ctx, projection, land, { color: PALETTE.ink, width: 0.8, alpha: 0.5 });
  }

  if (morphCells) {
    const cells = withinDomain(studCells(studCount), pair.maxLat);
    // Clipped to the map's own boundary. Holding the cells to +/-maxLat bounds
    // their coordinates, but the polar ones then have their clamped corners
    // rejoined along great circles, which bow well outside the frame.
    ctx.save();
    ctx.beginPath();
    geoPath(projection, ctx)(pair.domain);
    ctx.clip();
    drawCells(ctx, projection, cells, {
      maxLat: pair.maxLat,
      shrink: morphTiles,
      anchor: morphAnchor,
      shore: studShore(land, studCount),
      studCount,
    });
    ctx.restore();
  }

  if (morphTissot) drawIndicatrices(ctx, projection, studCount, pair.maxLat);

  if (!morphDots) return;

  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.globalAlpha = 0.55;
  const radius = studRadius(studCount);
  for (const [lon, lat] of studLattice(studCount)) {
    if (Math.abs(lat) > pair.maxLat) continue;
    const at = projection([lon, lat]);
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
    ctx.beginPath();
    ctx.arc(at[0], at[1], radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- globe --- */

/**
 * Every ring of a GeoJSON object, as arrays of [lon, lat]. topojson's `feature`
 * hands back a FeatureCollection even for a single named object, which geoPath
 * absorbs silently and a hand-written walker does not.
 */
function* rings(input) {
  if (input.type === 'FeatureCollection') {
    for (const child of input.features) yield* rings(child);
    return;
  }
  if (input.type === 'GeometryCollection') {
    for (const child of input.geometries) yield* rings(child);
    return;
  }
  const geometry = input.type === 'Feature' ? input.geometry : input;
  if (!geometry) return;
  const { type, coordinates } = geometry;
  if (type === 'MultiPolygon') for (const polygon of coordinates) yield* polygon;
  else if (type === 'Polygon' || type === 'MultiLineString') yield* coordinates;
  else if (type === 'LineString') yield coordinates;
}

/** Draws a geometry onto the displaced surface, dropping what is over the horizon. */
function strokeOnSphere(ctx, geometry, locate, { color, width, alpha }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const ring of rings(geometry)) {
    let drawing = false;
    for (const [lon, lat] of ring) {
      const point = locate(lon, lat);
      if (point.z <= 0) {
        drawing = false;
        continue;
      }
      if (drawing) ctx.lineTo(point.x, point.y);
      else {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** One globe: painter's-algorithm quads, then coastline and graticule on top. */
function drawGlobe(ctx, { mesh, radii, cam, land, quadColor, points, locate: given }) {
  const frame = buildFrame(mesh, radii, cam, points);
  const { sx, sy, order, shade: lambert, columns } = frame;
  const stride = columns + 1;

  for (let n = 0; n < order.length; n++) {
    const q = order[n];
    const i = q % columns;
    const p0 = ((q - i) / columns) * stride + i;
    const p3 = p0 + stride;
    // Fill only. The flat modes stroke each cell in its own colour to close the
    // seams between them, but that costs about four times what the fill does,
    // and here neighbouring quads already share their corner vertices exactly.
    ctx.fillStyle = shadeStep(quadColor(q, p0), lambert[q]);
    ctx.beginPath();
    ctx.moveTo(sx[p0], sy[p0]);
    ctx.lineTo(sx[p0 + 1], sy[p0 + 1]);
    ctx.lineTo(sx[p3 + 1], sy[p3 + 1]);
    ctx.lineTo(sx[p3], sy[p3]);
    ctx.fill();
  }

  const locate = given ?? locator(mesh, radii, cam, points);
  strokeOnSphere(ctx, GRATICULE, locate, { color: PALETTE.ink, width: 0.4, alpha: 0.14 });
  if (land) strokeOnSphere(ctx, land, locate, { color: PALETTE.ink, width: 0.75, alpha: 0.5 });
  return locate;
}

function caption(ctx, text, x, y, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Great-circle stalks. Each runs from a graticule node to the place map B
 * actually shows at the point where map A shows that node, so the arc is the
 * reading error you make by taking one map for the other.
 */
function drawArcs(ctx, arcs, locate) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const [fromLon, fromLat, toLon, toLat] of arcs) {
    const along = geoInterpolate([fromLon, fromLat], [toLon, toLat]);
    const points = [];
    for (let k = 0; k <= 8; k++) {
      const [lon, lat] = along(k / 8);
      const point = locate(lon, lat);
      if (point.z <= 0) {
        points.length = 0;
        break;
      }
      points.push(point);
    }
    if (points.length < 2) continue;

    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    for (const [point, color] of [
      [points[0], PALETTE.a],
      [points[points.length - 1], PALETTE.b],
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.7, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The whole globe at thumbnail size with the patch's window picked out on it,
 * so a close-up says where it was cut from. Drawn small and last, over the
 * corner of the panel.
 */
function drawWindow(ctx, { mesh, outline, at }, { x, y, radius }) {
  // Face-on to the window rather than following the drag: this is the locator,
  // and a locator that can turn its own subject out of sight is not one.
  const cam = camera({
    yaw: -at[0] * (Math.PI / 180),
    pitch: at[1] * (Math.PI / 180),
    scale: radius,
    cx: x,
    cy: y,
  });
  const radii = unitRadii(mesh);
  const locate = locator(mesh, radii, cam);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = PALETTE.sheetDeep;
  ctx.fill();
  ctx.restore();

  strokeOnSphere(ctx, GRATICULE, locate, { color: PALETTE.ink, width: 0.4, alpha: 0.2 });

  // The window is a ring on the globe, so half of it can be over the horizon.
  // Filling only the runs that face the camera keeps it from closing across the
  // back of the sphere.
  const ring = outline.map(([lon, lat]) => locate(lon, lat));
  ctx.save();
  ctx.beginPath();
  let drawing = false;
  for (const point of ring) {
    if (point.z <= 0) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(point.x, point.y);
    else {
      ctx.moveTo(point.x, point.y);
      drawing = true;
    }
  }
  ctx.closePath();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PALETTE.a;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** The comparison put back on the sphere. */
function renderGlobe(ctx, state) {
  const { globe, land, width, height } = state;
  if (!globe) return;
  const { mesh, field, layer, yaw, pitch } = globe;
  const view = { yaw, pitch };
  const stride = mesh.columns + 1;

  if (layer === 'patch') {
    const size = Math.min(width / 2.5, height - 96);
    for (const [radii, colour, cx, name, sheet] of [
      [globe.radiiA, PALETTE.a, width * 0.27, globe.names.a, globe.sheetA],
      [globe.radiiB, PALETTE.b, width * 0.73, globe.names.b, globe.sheetB],
    ]) {
      const cam = patchCamera(mesh, radii, { size, cx, cy: height / 2 - 12, ...view });
      drawGlobe(ctx, {
        mesh,
        radii,
        cam,
        land,
        locate: patchLocator(mesh, radii, cam),
        quadColor: (q, p0) =>
          intensityStep(colour, (sheet.excess[p0] + sheet.excess[p0 + stride + 1]) / 2 / globe.strainScale),
      });
      caption(ctx, name, cx, height / 2 + size / 2 + 26, colour);
    }
    drawWindow(ctx, globe.window, { x: 74, y: height - 74, radius: 58 });
    return;
  }

  if (layer === 'wrinkle' || layer === 'cloth') {
    const scale = Math.min(width / 4.6, height / 2.5);
    for (const [radii, color, cx, name, excess, points] of [
      [globe.radiiA, PALETTE.a, width * 0.27, globe.names.a, field.excessA, globe.pointsA],
      [globe.radiiB, PALETTE.b, width * 0.73, globe.names.b, field.excessB, globe.pointsB],
    ]) {
      const cam = camera({ ...view, scale, cx, cy: height / 2 });
      drawGlobe(ctx, {
        mesh,
        radii,
        points,
        cam,
        land,
        quadColor: globe.strainScale
          ? (q, p0) =>
              intensityStep(color, (excess[p0] + excess[p0 + stride + 1]) / 2 / globe.strainScale)
          : () => color,
      });
      caption(ctx, name, cx, height / 2 + scale + 26, color);
    }
    return;
  }

  const scale = Math.min(width, height) * 0.4;
  const cam = camera({ ...view, scale, cx: width / 2, cy: height / 2 });

  if (layer === 'arcs') {
    const locate = drawGlobe(ctx, {
      mesh,
      radii: globe.radii,
      cam,
      land,
      quadColor: () => PALETTE.land,
    });
    drawArcs(ctx, globe.arcs, locate);
    return;
  }

  drawGlobe(ctx, {
    mesh,
    radii: globe.radii,
    cam,
    land,
    quadColor: (q, p0) => {
      const value = (globe.values[p0] + globe.values[p0 + stride + 1]) / 2;
      return divergingStep(value / globe.range);
    },
  });
}

// Order here is the order of the chips. It is deliberately not the order in
// share.js, which fixes the byte a mode is stored as and so can never move.
export const MODES = {
  globe: {
    label: 'Globe',
    hint: 'The same comparison, put back on the sphere.',
    render: renderGlobe,
  },
  morph: {
    label: 'Morph',
    hint: 'Bend the first map into the second.',
    render: renderMorph,
  },
  outlines: {
    label: 'Outlines',
    hint: 'Both maps drawn on top of each other.',
    render: renderOutlines,
  },
  displacement: {
    label: 'Displacement',
    hint: 'How far each point of the graticule travels between the two.',
    render: renderDisplacement,
  },
  area: {
    label: 'Area',
    hint: 'Which map inflates the ground more, as a ratio.',
    render: (ctx, state) =>
      renderScalar(ctx, state, { value: (cell) => cell.arealRatio, range: state.areaRange }),
  },
  angle: {
    label: 'Angle',
    hint: 'Which map bends local shapes more, in degrees.',
    render: (ctx, state) =>
      renderScalar(ctx, state, { value: (cell) => cell.angularDelta, range: state.angleRange }),
  },
};

export function draw(ctx, width, height, state) {
  clear(ctx, width, height);
  const mode = MODES[state.mode] ?? MODES.outlines;
  const land = state.land && state.pair ? withinDomain(state.land, state.pair.maxLat) : state.land;
  mode.render(ctx, { ...state, land, width, height });
}
