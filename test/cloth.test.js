import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPair } from '../src/lib/diff.js';
import { sphereMesh } from '../src/lib/globe.js';
import { createDrape, drapeSheet, edgeError, standoff } from '../src/lib/cloth.js';

const mesh = sphereMesh(60, 30);
const mercator = buildPair({ idA: 'mercator', idB: 'equalEarth', width: 900, height: 500 });

test('settling brings the sheet closer to the lengths the map gave it', () => {
  const fresh = createDrape(mesh, mercator.rawA, mercator.maxLat, { bending: 0.12 });
  const before = edgeError(mesh, mercator.rawA, mercator.maxLat, fresh.points).mean;
  fresh.settle(200);
  const after = edgeError(mesh, mercator.rawA, mercator.maxLat, fresh.points).mean;

  // A third of every edge length out, down to a few percent: what is left is
  // folds finer than this mesh can hold, not a solver that stopped early.
  assert.ok(after < before / 4, `edge error went ${before.toFixed(3)} -> ${after.toFixed(3)}`);
  assert.ok(after < 0.1, `edge error settled at ${after.toFixed(3)}`);
});

test('the sheet lies on the globe and never sinks into it', () => {
  const points = drapeSheet(mesh, mercator.rawA, mercator.maxLat, { iterations: 200 });
  const off = standoff(mesh, points);

  let deepest = 0;
  for (let n = 0; n < mesh.count; n++) {
    assert.ok(Number.isFinite(off[n]), `vertex ${n} left the world`);
    deepest = Math.min(deepest, off[n]);
  }
  // The pole rows are collapsed onto the axis and can end up a hair inside.
  assert.ok(deepest > -0.02, `something sank ${deepest.toFixed(3)} into the globe`);
});

test('the excess gathers where the sheet has the most to shed', () => {
  const points = drapeSheet(mesh, mercator.rawA, mercator.maxLat, { iterations: 60 });
  const off = standoff(mesh, points);

  const bandMean = (from, to) => {
    let total = 0;
    let seen = 0;
    for (let n = 0; n < mesh.count; n++) {
      const lat = Math.abs(mesh.lat[n]);
      if (lat < from || lat > to) continue;
      total += Math.abs(off[n]);
      seen++;
    }
    return total / seen;
  };

  // Printed at the scale that never stretches, Mercator is taut along the
  // equator and hundreds of percent too long by the mid-latitudes. Not the
  // poles: fold depth is the arc-length law's (L/pi)*sqrt(e), and the parallels
  // are short enough up there that the excess goes into many fine folds rather
  // than a few deep ones — which is what gathered cloth does.
  assert.ok(
    bandMean(40, 60) > 2 * bandMean(0, 20),
    `mid-latitude ${bandMean(40, 60).toFixed(4)} vs equatorial ${bandMean(0, 20).toFixed(4)}`,
  );
  assert.ok(
    bandMean(70, 85) > bandMean(0, 20),
    `polar ${bandMean(70, 85).toFixed(4)} vs equatorial ${bandMean(0, 20).toFixed(4)}`,
  );
});

test('the same sheet always drapes the same way', () => {
  const first = drapeSheet(mesh, mercator.rawA, mercator.maxLat, { iterations: 60 });
  const second = drapeSheet(mesh, mercator.rawA, mercator.maxLat, { iterations: 60 });
  for (let n = 0; n < mesh.count; n++) {
    assert.equal(first.x[n], second.x[n]);
    assert.equal(first.y[n], second.y[n]);
    assert.equal(first.z[n], second.z[n]);
  }
});

test('the antimeridian stays stitched', () => {
  const points = drapeSheet(mesh, mercator.rawB, mercator.maxLat, { iterations: 120 });
  const stride = mesh.columns + 1;
  for (let j = 0; j <= mesh.rows; j++) {
    const west = j * stride;
    const east = west + mesh.columns;
    const gap = Math.hypot(
      points.x[east] - points.x[west],
      points.y[east] - points.y[west],
      points.z[east] - points.z[west],
    );
    assert.ok(gap < 1e-9, `row ${j} opened a ${gap.toExponential(1)} slit`);
  }
});
