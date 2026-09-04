import assert from 'node:assert/strict';
import test from 'node:test';
import { geoEquirectangularRaw, geoMercatorRaw } from 'd3-geo';
import { lookup } from '../src/lib/catalog.js';
import { buildPair, sampleField } from '../src/lib/diff.js';
import { areaNormalization, distortion, scaleRaw } from '../src/lib/distortion.js';
import { buildFrame, camera, sphereMesh, unitRadii } from '../src/lib/globe.js';
import {
  amplitudeFor,
  foldGeometry,
  globeField,
  MAX_SLOPE,
  reliefRadii,
  wrinkleRadii,
} from '../src/lib/relief.js';

const RADIANS = Math.PI / 180;
const DEGREES = 180 / Math.PI;
const at = (raw, lon, lat) => distortion(raw, lon * RADIANS, lat * RADIANS);

test('the Tissot major axis points along the stretched direction', () => {
  // Equirectangular at 60N: meridians keep their length, parallels double, so
  // the long axis lies due east and folds would run north-south.
  const local = at(geoEquirectangularRaw, 0, 60);
  assert.ok(Math.abs(local.a - 2) < 1e-6);
  assert.ok(Math.abs(local.theta) < 1e-6, `theta was ${local.theta * DEGREES} deg`);

  // Mercator is conformal, so the axes are equal and the bearing is degenerate
  // rather than wrong; what matters is that nothing anisotropic is claimed.
  const mercator = at(geoMercatorRaw, 0, 60);
  assert.ok(Math.abs(mercator.a - mercator.b) < 1e-9);
});

test('a sheet in tension does not buckle', () => {
  // Mercator's plane scale is a free choice until areaNormalization pins it.
  // Unnormalized it is exactly unit scale at the equator, so nothing is in
  // compression there and the fold amplitude has to be zero.
  const mesh = sphereMesh(36, 18);
  const field = globeField(mesh, geoMercatorRaw, geoMercatorRaw, 84);
  const radii = wrinkleRadii(mesh, field, 'a', 0.2);

  const equator = [];
  for (let n = 0; n < mesh.count; n++) {
    if (mesh.lat[n] === 0) equator.push(radii[n]);
  }
  assert.ok(equator.length > 0);
  for (const r of equator) assert.equal(r, 1);
});

test('fold amplitude follows the arc-length law up to the fold-over cap', () => {
  // A sinusoid of wavelength L absorbs strain e at amplitude (L/pi)*sqrt(e),
  // until the slope reaches the point where real material would fold over
  // instead and the amplitude is held flat.
  const mesh = sphereMesh(360, 180);
  const wavelength = 0.3;
  const { raw } = lookup('equirectangular');
  const field = globeField(mesh, raw, raw, 89);
  const radii = wrinkleRadii(mesh, field, 'a', wavelength);

  let underCap = 0;
  let atCap = 0;
  for (let n = 0; n < mesh.count; n++) {
    if (field.excessA[n] <= 0) continue;
    const { effective } = foldGeometry(mesh.lat[n], wavelength, field.thetaA[n]);
    const law = (wavelength / Math.PI) * Math.sqrt(field.excessA[n]) * (effective / wavelength);
    const cap = (MAX_SLOPE * effective) / (2 * Math.PI);
    const bound = Math.min(law, cap);
    if (bound < 1e-6) continue;

    const ratio = Math.abs(radii[n] - 1) / bound;
    assert.ok(ratio <= 1 + 1e-9, `amplitude reached ${ratio} of its bound at ${mesh.lat[n]}`);
    if (law < cap) underCap = Math.max(underCap, ratio);
    else atCap = Math.max(atCap, ratio);
  }
  assert.ok(underCap > 0.98, `the sqrt law is never reached: best was ${underCap}`);
  assert.ok(atCap > 0.98, `the cap never binds: best was ${atCap}`);
});

test('folds never exceed the slope they are capped at', () => {
  // The cap exists so a single carrier never has to stand in for material that
  // has folded over; the bound is on slope, so it has to hold at every spacing.
  for (const wavelength of [0.08, 0.2, 0.4]) {
    for (const excess of [0.01, 1, 50]) {
      const { effective } = foldGeometry(0, wavelength, 0);
      const slope = (amplitudeFor(excess, effective) * 2 * Math.PI) / effective;
      assert.ok(slope <= MAX_SLOPE + 1e-12, `slope ${slope} at L=${wavelength}, e=${excess}`);
    }
  }
});

test('equal-area projections still buckle', () => {
  // ab = 1 kills the area error but not the excess length: a sheet stretched
  // one way and squeezed the other has the same area and still cannot lie flat.
  const mesh = sphereMesh(90, 45);
  for (const id of ['mollweide', 'sinusoidal', 'equalEarth']) {
    const { raw } = lookup(id);
    const normalized = scaleRaw(raw, areaNormalization(raw));
    const field = globeField(mesh, normalized, normalized, 89);

    let excess = 0;
    for (let n = 0; n < mesh.count; n++) excess = Math.max(excess, field.excessA[n]);
    assert.ok(excess > 0.05, `${id} reported almost no compression: ${excess}`);
  }
});

test('an undisplaced mesh is exactly the unit sphere', () => {
  const mesh = sphereMesh(48, 24);
  const radii = unitRadii(mesh);
  for (let n = 0; n < mesh.count; n++) {
    assert.ok(Math.abs(Math.hypot(mesh.ux[n], mesh.uy[n], mesh.uz[n]) * radii[n] - 1) < 1e-12);
  }
});

test('the camera rotation is orthonormal', () => {
  const cam = camera({ yaw: 0.7, pitch: -0.4, scale: 1, cx: 0, cy: 0 });
  const out = [0, 0, 0];
  const other = [0, 0, 0];
  const p = [0.3, -0.5, 0.81];
  const q = [-0.6, 0.2, 0.77];

  cam.view(p[0], p[1], p[2], out);
  cam.view(q[0], q[1], q[2], other);

  const before = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const after = Math.hypot(out[0] - other[0], out[1] - other[1], out[2] - other[2]);
  assert.ok(Math.abs(before - after) < 1e-12, 'chord length must survive rotation');
  assert.ok(Math.abs(Math.hypot(...out) - Math.hypot(...p)) < 1e-12, 'radius must survive it too');
});

test('only the near half is drawn, back to front', () => {
  const mesh = sphereMesh(36, 18);
  const frame = buildFrame(mesh, unitRadii(mesh), camera({ yaw: 0.3, pitch: 0.2, scale: 100, cx: 0, cy: 0 }));

  assert.ok(frame.order.length > 0);
  assert.ok(frame.order.length < mesh.columns * mesh.rows * 0.6, 'the far side must be culled');
  for (let n = 1; n < frame.order.length; n++) {
    assert.ok(
      frame.depth[frame.order[n]] >= frame.depth[frame.order[n - 1]],
      'quads must be ordered far to near',
    );
  }
  for (const q of frame.order) {
    assert.ok(frame.shade[q] > 0 && frame.shade[q] <= 1, 'shading stays in range');
  }
});

test('relief leans the same way the flat area map is coloured', () => {
  const pair = buildPair({ idA: 'mercator', idB: 'equalEarth', width: 900, height: 500 });
  const flat = sampleField(pair, { columns: 72, rows: 36 });
  const mesh = sphereMesh(72, 36);
  const field = globeField(mesh, pair.rawA, pair.rawB, pair.maxLat);
  const radii = reliefRadii(mesh, field.arealRatio, { range: 1, amplitude: 0.25 });

  let compared = 0;
  for (let n = 0; n < mesh.count; n++) {
    if (!field.defined[n]) continue;
    const here = distortion(pair.rawA, mesh.lon[n] * RADIANS, mesh.lat[n] * RADIANS);
    const there = distortion(pair.rawB, mesh.lon[n] * RADIANS, mesh.lat[n] * RADIANS);
    if (!here || !there) continue;
    const flatSign = Math.sign(Math.log2(here.areal / there.areal));
    const reliefSign = Math.sign(radii[n] - 1);
    if (flatSign !== 0) {
      assert.equal(reliefSign, flatSign, `disagreed at ${mesh.lon[n]},${mesh.lat[n]}`);
      compared++;
    }
  }
  assert.ok(compared > 1000, `only ${compared} points compared`);
  assert.ok(flat.cells.length > 0);
});

test('every catalog entry produces a finite globe', () => {
  const mesh = sphereMesh(36, 18);
  for (const id of ['mercator', 'azimuthalEqualArea', 'vanDerGrinten', 'collignon', 'polyconic']) {
    const pair = buildPair({ idA: id, idB: 'equirectangular', width: 900, height: 500 });
    const field = globeField(mesh, pair.rawA, pair.rawB, pair.maxLat);
    const radii = wrinkleRadii(mesh, field, 'a', 0.18);
    for (let n = 0; n < mesh.count; n++) {
      assert.ok(Number.isFinite(radii[n]), `${id} produced a non-finite radius`);
      assert.ok(radii[n] > 0.2 && radii[n] < 3, `${id} radius out of range: ${radii[n]}`);
    }
  }
});

test('the fold carrier cannot tell the two ends of an axis apart', () => {
  // theta is an axis bearing, known only modulo pi. If the carrier is not even
  // in it, the wrap at 180 degrees flips the fold phase and paints a whorl
  // across every projection whose major axis rotates that far — Equal Earth's
  // does, between the equator and the pole.
  const mesh = sphereMesh(72, 36);
  const base = globeField(mesh, lookup('equalEarth').raw, lookup('equirectangular').raw, 89);
  const flipped = {
    ...base,
    thetaA: base.thetaA.map((angle) => angle + Math.PI),
  };

  const straight = wrinkleRadii(mesh, base, 'a', 0.25);
  const turned = wrinkleRadii(mesh, flipped, 'a', 0.25);
  for (let n = 0; n < mesh.count; n++) {
    assert.ok(
      Math.abs(straight[n] - turned[n]) < 1e-12,
      `flipping the axis at ${mesh.lon[n]},${mesh.lat[n]} moved the surface`,
    );
  }
});

test('two equal-area maps differ in stretch but not in area', () => {
  const pair = buildPair({ idA: 'equalEarth', idB: 'boggs', width: 900, height: 500 });
  const mesh = sphereMesh(72, 36);
  const field = globeField(mesh, pair.rawA, pair.rawB, pair.maxLat);

  let worstArea = 0;
  let worstStrain = 0;
  for (let n = 0; n < mesh.count; n++) {
    if (!field.defined[n]) continue;
    worstArea = Math.max(worstArea, Math.abs(field.arealRatio[n]));
    worstStrain = Math.max(worstStrain, Math.abs(field.strainDelta[n]));
  }
  // Not exactly zero: the Jacobian is a central difference, so an exactly
  // equal-area pair still measures a couple of parts in ten million.
  assert.ok(worstArea < 1e-5, `area ratio should vanish, worst was ${worstArea}`);
  assert.ok(worstStrain > 0.5, `stretch should not, worst was ${worstStrain}`);
});

test('the relief follows whichever measure it is given', () => {
  const pair = buildPair({ idA: 'equalEarth', idB: 'boggs', width: 900, height: 500 });
  const mesh = sphereMesh(72, 36);
  const field = globeField(mesh, pair.rawA, pair.rawB, pair.maxLat);
  const byArea = reliefRadii(mesh, field.arealRatio, { range: 1, amplitude: 0.25 });
  const byStrain = reliefRadii(mesh, field.strainDelta, { range: 1, amplitude: 0.25 });

  let moved = 0;
  for (let n = 0; n < mesh.count; n++) {
    assert.ok(Math.abs(byArea[n] - 1) < 1e-6);
    if (Math.abs(byStrain[n] - 1) > 1e-6) moved++;
  }
  assert.ok(moved > 1000, `only ${moved} vertices moved`);
});
