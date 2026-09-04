#!/usr/bin/env node
// Checks a projection against the properties it claims, by measuring rather
// than by reading its definition.
//
//   node scripts/audit.mjs equal-area [ids...]   share of the sheet above each
//                                                parallel, against the sphere's
//   node scripts/audit.mjs symmetry [ids...]     strain at mirrored points
//
// Both default to the equal-area and pseudocylindrical families, which are
// where the two questions come up.

import { CATALOG } from '../src/lib/catalog.js';
import { distortion } from '../src/lib/distortion.js';

const RADIANS = Math.PI / 180;
const STEP = 0.25; // degrees, for the area integration
const EPS = 1e-5; // radians, matching distortion.js

const DEFAULTS = ['equalEarth', 'boggs', 'mollweide', 'sinusoidal', 'robinson', 'winkel3'];
const PARALLELS = [66.5, 60, 30, 0, -30, -60];

const lookup = (id) => {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) {
    process.stderr.write(`no projection "${id}" — try: node scripts/report.mjs --list\n`);
    process.exit(1);
  }
  return entry;
};

/** Planar area of one lon/lat cell: |det d(x,y)/d(lambda,phi)|. */
function jacobian(raw, lambda, phi) {
  const [xl0, yl0] = raw(lambda - EPS, phi);
  const [xl1, yl1] = raw(lambda + EPS, phi);
  const [xp0, yp0] = raw(lambda, phi - EPS);
  const [xp1, yp1] = raw(lambda, phi + EPS);
  const det = Math.abs(
    ((xl1 - xl0) / (2 * EPS)) * ((yp1 - yp0) / (2 * EPS)) -
      ((xp1 - xp0) / (2 * EPS)) * ((yl1 - yl0) / (2 * EPS)),
  );
  return Number.isFinite(det) ? det : 0;
}

/**
 * Ink between two parallels. Integrating the Jacobian rather than measuring the
 * projected outline, because a pointed-pole map and a pole-line map bound that
 * region with different shapes and the same integral covers both.
 */
function sheetArea(raw, latFrom, latTo) {
  let total = 0;
  for (let lat = latFrom; lat < latTo; lat += STEP) {
    for (let lon = -180; lon < 180; lon += STEP) {
      total += jacobian(raw, (lon + STEP / 2) * RADIANS, (lat + STEP / 2) * RADIANS) * (STEP * RADIANS) ** 2;
    }
  }
  return total;
}

function equalArea(ids) {
  process.stdout.write(
    'Share of the sheet above each parallel. An equal-area map matches the\n' +
      'sphere column exactly; anything else inflates one end of the world.\n\n',
  );
  const header = PARALLELS.map((lat) => `${lat}`.padStart(8)).join('');
  process.stdout.write(`${''.padEnd(14)}${header}\n`);
  process.stdout.write(
    `${'sphere'.padEnd(14)}` +
      PARALLELS.map((lat) => `${(((1 - Math.sin(lat * RADIANS)) / 2) * 100).toFixed(2)}%`.padStart(8)).join('') +
      '\n',
  );

  ids.forEach((id, index) => {
    const { raw, maxLat = 89.75 } = lookup(id);
    const whole = sheetArea(raw, -maxLat, maxLat);
    const row = PARALLELS.map((lat) =>
      `${((100 * sheetArea(raw, lat, maxLat)) / whole).toFixed(2)}%`.padStart(8),
    ).join('');
    process.stdout.write(`${id.padEnd(14)}${row}   ${index + 1}/${ids.length}\n`);
  });
}

function symmetry(ids) {
  process.stdout.write(
    'Excess length at mirrored points. A projection symmetric about its central\n' +
      'meridian or the equator reports zero mismatch, so a globe that looks\n' +
      'brighter on one side is being lit that way, not measured that way.\n\n',
  );
  process.stdout.write(`${''.padEnd(14)}${'east/west'.padStart(12)}${'north/south'.padStart(14)}\n`);

  ids.forEach((id, index) => {
    const { raw } = lookup(id);
    let eastWest = 0;
    let northSouth = 0;
    for (let lat = -85; lat <= 85; lat += 5) {
      for (let lon = 5; lon <= 175; lon += 5) {
        const east = distortion(raw, lon * RADIANS, lat * RADIANS);
        const west = distortion(raw, -lon * RADIANS, lat * RADIANS);
        const north = distortion(raw, lon * RADIANS, Math.abs(lat) * RADIANS);
        const south = distortion(raw, lon * RADIANS, -Math.abs(lat) * RADIANS);
        if (east && west) eastWest = Math.max(eastWest, Math.abs(east.a - west.a));
        if (north && south) northSouth = Math.max(northSouth, Math.abs(north.a - south.a));
      }
    }
    const cell = (value) => `${(value * 100).toFixed(4)}pp`.padStart(12);
    process.stdout.write(`${id.padEnd(14)}${cell(eastWest)}${cell(northSouth).padStart(14)}   ${index + 1}/${ids.length}\n`);
  });
}

const [check, ...rest] = process.argv.slice(2);
const ids = rest.length ? rest : DEFAULTS;

if (check === 'equal-area') equalArea(ids);
else if (check === 'symmetry') symmetry(ids);
else {
  process.stdout.write('Usage: node scripts/audit.mjs equal-area|symmetry [ids...]\n');
  process.exit(1);
}
