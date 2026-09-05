import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPair } from '../src/lib/diff.js';
import { indicatrix } from '../src/lib/render.js';

const pair = buildPair({ idA: 'mercator', idB: 'equalEarth', width: 900, height: 500 });

/** The indicatrix at a scatter of places well inside the compared domain. */
function field(projection) {
  const marks = [];
  for (let lat = -70; lat <= 70; lat += 10) {
    for (let lon = -170; lon <= 170; lon += 20) {
      const mark = indicatrix(projection, lon, lat);
      if (mark) marks.push(mark);
    }
  }
  assert.ok(marks.length > 250, `only ${marks.length} marks`);
  return marks;
}

test('a conformal map draws every indicatrix as a circle', () => {
  let worst = 0;
  for (const { major, minor } of field(pair.projA)) worst = Math.max(worst, major / minor - 1);
  // Mercator bends no local shape, so the two axes are the same length
  // everywhere. What is left is the central difference, not the projection.
  assert.ok(worst < 1e-3, `axes differed by ${(worst * 100).toFixed(3)}%`);
});

test('an equal-area map draws every indicatrix at the same size', () => {
  const areas = field(pair.projB).map(({ major, minor }) => major * minor);
  const mean = areas.reduce((a, b) => a + b) / areas.length;
  let worst = 0;
  for (const area of areas) worst = Math.max(worst, Math.abs(area / mean - 1));
  assert.ok(worst < 1e-3, `areas differed by ${(worst * 100).toFixed(3)}%`);
});

test('an equal-area map pays for its area in shape, worst at the limb', () => {
  // Equal Earth holds every indicatrix to the same area, so all it can do with
  // the strain is stretch them. Its centre is already 1.35 to 1 — no part of a
  // pseudocylindrical map is free — and out on the limb, where the parallels
  // are squeezed hardest, that more than doubles.
  const middle = indicatrix(pair.projB, 0, 0);
  const limb = indicatrix(pair.projB, 175, 60);
  assert.ok(
    limb.major / limb.minor > 2 * (middle.major / middle.minor),
    `limb ${(limb.major / limb.minor).toFixed(2)} vs centre ${(middle.major / middle.minor).toFixed(2)}`,
  );
});
