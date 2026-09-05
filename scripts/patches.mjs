/**
 * Close-up wrinkle patches at the points where the law changes its mind.
 *
 * The whole-globe view has one fold every dozen degrees, which is enough to see
 * that a map ruffles and not enough to see what decides the ruffle. Each patch
 * here is a few tens of degrees wide at four times the fold count, centred on a
 * place where the buckling law does something specific — hands the excess from
 * one carrier to the other, passes exactly through zero, or hits the vertex
 * that sets the size of the whole sheet.
 *
 *   node scripts/patches.mjs [--out path.html] [--folds 4.5] [--tile 460]
 *
 * Writes one HTML file of inline SVG, so it needs no rasterizer: open it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { lookup } from '../src/lib/catalog.js';
import { buildPair } from '../src/lib/diff.js';
import { distortion } from '../src/lib/distortion.js';
import { buildFrame } from '../src/lib/globe.js';
import { intensityStep, PALETTE, shadeStep } from '../src/lib/palette.js';
import {
  PATCH_SITES,
  patchCamera,
  patchColumns,
  patchLocator,
  patchMesh,
  patchWavelength,
} from '../src/lib/patch.js';
import { sheetField, sheetWrinkle } from '../src/lib/relief.js';

const RADIANS = Math.PI / 180;

const DEFAULTS = { tile: 460, folds: 4.5, out: '.shots/patches.html' };

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in options)) throw new Error(`unknown option --${key}`);
    options[key] = key === 'out' ? argv[i + 1] : Number(argv[i + 1]);
  }
  return options;
}

/** Meridians and parallels every 5°, clipped to the patch, as [lon, lat] runs. */
function graticule(mesh, step = 5) {
  const lonMin = mesh.lon[0];
  const lonMax = mesh.lon[mesh.columns];
  const latMax = mesh.lat[0];
  const latMin = mesh.lat[mesh.count - 1];
  const lines = [];
  const from = (value) => Math.ceil(value / step) * step;

  for (let lon = from(lonMin); lon <= lonMax; lon += step) {
    const run = [];
    for (let lat = latMin; lat <= latMax; lat += 0.25) run.push([lon, lat]);
    lines.push(run);
  }
  for (let lat = from(latMin); lat <= latMax; lat += step) {
    const run = [];
    for (let lon = lonMin; lon <= lonMax; lon += 0.25) run.push([lon, lat]);
    lines.push(run);
  }
  return lines;
}

/** The 90th percentile of a patch's own excess, so each one is legible alone. */
function strainCap(sheet, count) {
  const values = [];
  for (let n = 0; n < count; n++) if (sheet.defined[n]) values.push(sheet.excess[n]);
  values.sort((x, y) => x - y);
  return Math.max(1e-4, values[Math.floor(values.length * 0.9)] ?? 1e-4);
}

/**
 * One patch as an SVG fragment. The quad loop mirrors `drawGlobe`: painter's
 * order out of `buildFrame`, one flat fill per cell, the shared corners closing
 * the seams.
 */
function renderPatch(mesh, radii, sheet, colour, tile) {
  const cam = patchCamera(mesh, radii, { size: tile - 8, cx: tile / 2, cy: tile / 2 });
  const frame = buildFrame(mesh, radii, cam);
  const { sx, sy, order, shade, columns } = frame;

  const px = (v) => v.toFixed(1);
  const py = (v) => v.toFixed(1);

  const cap = strainCap(sheet, mesh.count);
  const stride = columns + 1;
  const parts = [];
  for (let k = 0; k < order.length; k++) {
    const q = order[k];
    const i = q % columns;
    const p0 = ((q - i) / columns) * stride + i;
    const p3 = p0 + stride;
    const tint = intensityStep(colour, (sheet.excess[p0] + sheet.excess[p3 + 1]) / 2 / cap);
    const points = [p0, p0 + 1, p3 + 1, p3].map((p) => `${px(sx[p])},${py(sy[p])}`).join(' ');
    parts.push(`<polygon points="${points}" fill="${shadeStep(tint, shade[q])}"/>`);
  }

  const locate = patchLocator(mesh, radii, cam);
  for (const run of graticule(mesh)) {
    const d = run
      .map(([lon, lat], index) => {
        const at = locate(lon, lat);
        return `${index ? 'L' : 'M'}${px(at.x)} ${py(at.y)}`;
      })
      .join('');
    parts.push(`<path d="${d}" fill="none" stroke="${PALETTE.ink}" stroke-opacity="0.2" stroke-width="0.7"/>`);
  }

  return `<svg viewBox="0 0 ${tile} ${tile}" width="${tile}" height="${tile}">${parts.join('')}</svg>`;
}

const options = parseArgs(process.argv.slice(2));
const cards = [];

PATCH_SITES.forEach((patch, index) => {
  const entry = lookup(patch.projection);
  // buildPair is what normalizes a raw projection to unit-sphere area, and it
  // only does it in pairs; the partner is never drawn.
  const pair = buildPair({ idA: patch.projection, idB: 'equirectangular', width: 900, height: 500 });
  const { span } = patch;
  const lons = patch.series ?? [patch.at[0]];
  const tile = patch.series ? Math.round(options.tile / patch.series.length) - 4 : options.tile;

  const plates = [];
  const readings = [];
  for (const lon of lons) {
    const mesh = patchMesh([lon, patch.at[1]], span, patchColumns(options.folds));
    const sheet = sheetField(mesh, pair.rawA, pair.maxLat);

    // Fold count is global — a whole number around the world — so asking for a
    // given number of folds across the patch is what sets the wavelength.
    const radii = sheetWrinkle(mesh, sheet, patchWavelength(span, options.folds));
    // Near an isocol the excess is genuinely tiny, and a patch drawn to the
    // law's own scale is a flat sheet with a hint of shading on it.
    if (patch.exaggerate) {
      for (let n = 0; n < mesh.count; n++) radii[n] = 1 + (radii[n] - 1) * patch.exaggerate;
    }

    const local = distortion(pair.rawA, lon * RADIANS, patch.at[1] * RADIANS);
    readings.push(
      local
        ? `${lons.length > 1 ? `${lon}°: ` : ''}a ${local.a.toFixed(2)} · b ${local.b.toFixed(2)}` +
            ` · axis ${(local.theta / RADIANS).toFixed(0)}° from east`
        : 'undefined here',
    );
    plates.push(renderPatch(mesh, radii, sheet, PALETTE.a, tile));
  }

  const measured = readings.join('<br>');
  cards.push(
    `<figure${patch.series ? ' class="wide"' : ''}><div class="plate">${plates.join('')}</div>` +
      `<figcaption><h2>${entry.name} — ${patch.title}</h2><p>${patch.why}</p>` +
      `<p class="measured">${measured}<br>${span}° tall · ${options.folds} folds` +
      `${patch.exaggerate ? ` · depth ×${patch.exaggerate}` : ''}</p></figcaption></figure>`,
  );
  console.log(`${index + 1}/${PATCH_SITES.length}  ${entry.name} — ${readings.join(' | ')}`);
});

const html = `<!doctype html><meta charset="utf-8"><title>Wrinkle patches</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 40px; background: ${PALETTE.sheet}; color: ${PALETTE.ink};
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lede { color: ${PALETTE.inkSoft}; margin: 0 0 32px; max-width: 60ch; }
  figure { display: grid; grid-template-columns: ${options.tile}px minmax(0, 46ch);
           gap: 28px; align-items: start; margin: 0 0 32px; }
  figure.wide { grid-template-columns: minmax(0, 1fr); }
  figure.wide figcaption { max-width: 64ch; }
  .plate { background: #fff; border: 1px solid ${PALETTE.hairline}; border-radius: 3px;
           line-height: 0; display: flex; gap: 6px; }
  figcaption h2 { font-size: 16px; margin: 0 0 8px; }
  figcaption p { margin: 0 0 10px; }
  .measured { color: ${PALETTE.inkSoft}; font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
</style>
<h1>Wrinkle patches</h1>
<p class="lede">Each sheet laid back on the globe and ruffled by the arc-length law, close enough to
see which way the folds run. Colour is the local excess, capped at each patch’s own 90th percentile.</p>
${cards.join('\n')}
`;

const out = resolve(options.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`\nwrote ${out}`);
