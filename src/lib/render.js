import { geoGraticule10, geoInterpolate, geoPath } from 'd3-geo';
import { buildFrame, camera, locator } from './globe.js';
import { diverging, divergingStep, intensityStep, PALETTE, shadeStep } from './palette.js';

const GRATICULE = geoGraticule10();

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

/** One projection bent into the other. Motion makes small differences obvious. */
function renderMorph(ctx, { pair, land, morphT }) {
  const projection = pair.morph(morphT);
  drawBase(ctx, projection, land, pair.domain, { landAlpha: 0.75 });
  if (land) strokeGeometry(ctx, projection, land, { color: PALETTE.ink, width: 0.8, alpha: 0.5 });
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
function drawGlobe(ctx, { mesh, radii, cam, land, quadColor }) {
  const frame = buildFrame(mesh, radii, cam);
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

  const locate = locator(mesh, radii, cam);
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

/** The comparison put back on the sphere. */
function renderGlobe(ctx, state) {
  const { globe, land, width, height, areaRange } = state;
  if (!globe) return;
  const { mesh, field, layer, yaw, pitch } = globe;
  const view = { yaw, pitch };
  const stride = mesh.columns + 1;

  if (layer === 'wrinkle') {
    const scale = Math.min(width / 4.6, height / 2.5);
    for (const [radii, color, cx, name, excess] of [
      [globe.radiiA, PALETTE.a, width * 0.27, globe.names.a, field.excessA],
      [globe.radiiB, PALETTE.b, width * 0.73, globe.names.b, field.excessB],
    ]) {
      const cam = camera({ ...view, scale, cx, cy: height / 2 });
      drawGlobe(ctx, {
        mesh,
        radii,
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
      const ratio = (field.arealRatio[p0] + field.arealRatio[p0 + stride + 1]) / 2;
      return divergingStep(ratio / areaRange);
    },
  });
}

export const MODES = {
  globe: {
    label: 'Globe',
    hint: 'The same comparison, put back on the sphere.',
    render: renderGlobe,
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
  morph: {
    label: 'Morph',
    hint: 'Bend the first map into the second.',
    render: renderMorph,
  },
};

export function draw(ctx, width, height, state) {
  clear(ctx, width, height);
  const mode = MODES[state.mode] ?? MODES.outlines;
  mode.render(ctx, { ...state, width, height });
}
