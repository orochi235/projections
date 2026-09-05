import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG } from '../src/lib/catalog.js';
import { decodeState, encodeState } from '../src/lib/share.js';

const DEFAULTS = {
  idA: 'mercator',
  idB: 'equalEarth',
  mode: 'globe',
  rotate: 0,
  columns: 72,
  morphT: 0.5,
  globeLayer: 'relief',
  reliefSource: 'area',
  contrast: 1,
  shadeStrain: true,
  tilt: 0.32,
  globeColumns: 180,
  exaggeration: 0.22,
  foldScale: 0.3,
  wavelength: 0.22,
  morphBare: true,
  morphDots: true,
  morphCells: false,
  morphTiles: false,
  morphAnchor: true,
  morphTissot: false,
  morphPlay: false,
  morphShore: true,
  studCount: 1400,
  patchSite: 'isocol',
  patchFolds: 4.5,
};

test('the defaults need no hash at all', () => {
  assert.equal(encodeState(DEFAULTS, DEFAULTS), '');
  assert.deepEqual(decodeState(''), {});
});

test('every setting survives the round trip', () => {
  const moved = {
    ...DEFAULTS,
    idA: 'sinusoidal',
    idB: 'winkel3',
    mode: 'morph',
    globeLayer: 'patch',
    reliefSource: 'strain',
    patchSite: 'crushed',
    rotate: -75,
    morphT: 0.35,
    // The slider moves in quarter-stops, and that is the grid stored.
    contrast: 2 ** 1.25,
    tilt: -0.44,
    exaggeration: 0.4,
    foldScale: 0.45,
    wavelength: 0.31,
    patchFolds: 6.5,
    studCount: 2600,
    columns: 108,
    globeColumns: 450,
    shadeStrain: false,
    morphBare: false,
    morphDots: false,
    morphCells: true,
    morphTiles: true,
    morphAnchor: false,
    morphTissot: true,
    morphShore: false,
  };
  const back = { ...DEFAULTS, ...decodeState(encodeState(moved, DEFAULTS)) };
  for (const key of Object.keys(moved)) {
    if (typeof moved[key] === 'number') {
      assert.ok(
        Math.abs(back[key] - moved[key]) < Math.max(1e-9, Math.abs(moved[key]) * 0.01),
        `${key} came back ${back[key]} instead of ${moved[key]}`,
      );
    } else {
      assert.equal(back[key], moved[key], `${key} came back ${back[key]}`);
    }
  }
});

test('every projection in the catalog can be named in a link', () => {
  for (const entry of CATALOG) {
    // Read the way the app reads it: what the token carried, over the defaults.
    // A projection that is already the default writes nothing, which is the
    // compression working rather than the id being lost.
    const token = encodeState({ ...DEFAULTS, idA: entry.id }, DEFAULTS);
    const back = { ...DEFAULTS, ...decodeState(token) };
    assert.equal(back.idA, entry.id, `${entry.id} did not survive`);
  }
});

test('a link stays short enough to paste', () => {
  const token = encodeState({ ...DEFAULTS, mode: 'morph', morphCells: true, idB: 'sinusoidal' }, DEFAULTS);
  assert.ok(token.length <= 12, `${token.length} characters: ${token}`);
});

test('a playing blend links as playing, not as one frame of itself', () => {
  const playing = { ...DEFAULTS, mode: 'morph', morphPlay: true, morphT: 0.37 };
  const back = { ...DEFAULTS, ...decodeState(encodeState(playing, DEFAULTS)) };
  assert.equal(back.morphPlay, true);
  assert.equal(back.morphT, DEFAULTS.morphT, 'the frame it was on came along');

  // Paused, the position is the whole point of the link.
  const paused = { ...playing, morphPlay: false };
  assert.ok(Math.abs({ ...DEFAULTS, ...decodeState(encodeState(paused, DEFAULTS)) }.morphT - 0.37) < 0.01);
});

test('a mangled hash opens the app rather than breaking it', () => {
  for (const junk of ['!!!!', 'z', '////', 'AAAAAAAAAAAAAAAAAAAA']) {
    assert.doesNotThrow(() => decodeState(junk), `threw on ${junk}`);
  }
});
