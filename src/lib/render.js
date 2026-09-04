import { geoGraticule10, geoPath } from 'd3-geo';
import { diverging, PALETTE } from './palette.js';

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

export const MODES = {
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
  mode.render(ctx, state);
}
