import assert from 'node:assert/strict';
import test from 'node:test';
import { geoContains, geoEquirectangularRaw, geoMercatorRaw, geoPath } from 'd3-geo';
import { CATALOG, lookup } from '../src/lib/catalog.js';
import { areaNormalization, distortion, scaleRaw } from '../src/lib/distortion.js';
import { buildPair, sampleField } from '../src/lib/diff.js';

const RADIANS = Math.PI / 180;
const at = (raw, lon, lat) => distortion(raw, lon * RADIANS, lat * RADIANS);

// The projections whose distortion is known in closed form, used as the anchor
// for everything else.
test('Mercator matches sec(phi) along both axes', () => {
  for (const lat of [0, 30, 45, 60, 75]) {
    const local = at(geoMercatorRaw, 0, lat);
    const sec = 1 / Math.cos(lat * RADIANS);
    assert.ok(Math.abs(local.h - sec) < 1e-6, `h at ${lat}`);
    assert.ok(Math.abs(local.k - sec) < 1e-6, `k at ${lat}`);
    assert.ok(Math.abs(local.areal - sec ** 2) < 1e-5, `area at ${lat}`);
    assert.ok(local.angular < 1e-6, `Mercator is conformal, so no shear at ${lat}`);
  }
});

test('equirectangular stretches parallels only', () => {
  const local = at(geoEquirectangularRaw, 0, 60);
  assert.ok(Math.abs(local.h - 1) < 1e-6);
  assert.ok(Math.abs(local.k - 2) < 1e-6);
  // a = 2, b = 1, so the maximum angular deformation is 2 * asin(1/3).
  const expected = (2 * Math.asin(1 / 3) * 180) / Math.PI;
  assert.ok(Math.abs(local.angular - expected) < 1e-4);
});

test('area normalization makes an equal-area projection read exactly 1', () => {
  for (const id of ['mollweide', 'equalEarth', 'sinusoidal', 'hammer', 'azimuthalEqualArea']) {
    const { raw } = lookup(id);
    const normalized = scaleRaw(raw, areaNormalization(raw));
    for (const [lon, lat] of [[0, 0], [90, 30], [-140, -55], [170, 70]]) {
      const local = at(normalized, lon, lat);
      assert.ok(Math.abs(local.areal - 1) < 1e-3, `${id} at ${lon},${lat}: ${local?.areal}`);
    }
  }
});

test('non-differentiable points report nothing rather than noise', () => {
  // The antipode of an azimuthal projection: d3 returns a finite coordinate,
  // but the point maps to the entire rim of the disc.
  const { raw } = lookup('azimuthalEqualArea');
  assert.equal(at(raw, 180, 0), null);
  assert.equal(at(raw, -180, 0), null);
  assert.notEqual(at(raw, 170, 0), null);
});

test('every catalog entry survives a full sample against equirectangular', () => {
  for (const entry of CATALOG) {
    const pair = buildPair({ idA: entry.id, idB: 'equirectangular', width: 900, height: 500 });
    const field = sampleField(pair, { columns: 36, rows: 18 });
    assert.ok(field.cells.length > 500, `${entry.id} produced ${field.cells.length} cells`);
    assert.ok(Number.isFinite(field.summary.a.areal), `${entry.id} areal score`);
    assert.ok(Number.isFinite(field.summary.a.angular), `${entry.id} angular score`);
    assert.ok(field.summary.a.angular < 90, `${entry.id} angular score is out of range`);
  }
});

test('identical projections diff to nothing', () => {
  const pair = buildPair({ idA: 'robinson', idB: 'robinson', width: 900, height: 500 });
  const field = sampleField(pair, { columns: 24, rows: 12 });
  assert.ok(field.summary.displacement.max < 1e-6);
  for (const cell of field.cells) {
    assert.ok(Math.abs(cell.arealRatio) < 1e-9);
    assert.ok(Math.abs(cell.angularDelta) < 1e-9);
  }
});

test('the world the pair covers is a band, not a ring with a seam in it', () => {
  const pair = buildPair({ idA: 'mercator', idB: 'equalEarth', width: 834, height: 469 });
  for (const lon of [-180, -90, 0, 35, 145, 180]) {
    assert.ok(geoContains(pair.domain, [lon, 0]), `the equator at ${lon} is outside the domain`);
  }
  assert.ok(!geoContains(pair.domain, [0, 89]), 'the north cap is inside the domain');
  assert.ok(!geoContains(pair.domain, [0, -89]), 'the south cap is inside the domain');
});

test('turning the central meridian does not draw a line down the middle', () => {
  // The outline is the same length wherever the map is cut. A domain written as
  // one ring closed along the 180th meridian is not: turn the map and that edge
  // lands inside the frame, adding its own height to the outline — and drawing
  // itself across the picture.
  const frame = { idA: 'mercator', idB: 'equalEarth', width: 834, height: 469 };
  const outline = (rotate) => {
    const pair = buildPair({ ...frame, rotate });
    return geoPath(pair.morph(0.5)).measure(pair.domain);
  };
  const straight = outline(0);
  for (const rotate of [-170, 45, 90, 145]) {
    assert.ok(
      Math.abs(outline(rotate) - straight) < 1,
      `at ${rotate} the outline measured ${outline(rotate).toFixed(1)} against ${straight.toFixed(1)}`,
    );
  }
});
