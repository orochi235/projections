/**
 * The whole view as a URL hash, short enough to paste into a sentence.
 *
 * Two things keep it short. Only settings that differ from the defaults are
 * written, so the common link carries three or four of them. And each one is a
 * pair of bytes — a code and a quantized value — rather than text, because
 * base64 costs a third on top of whatever it is given and a readable token
 * would arrive longer than an opaque one.
 *
 * Every quantization here is at or below the step of the control that sets it,
 * so a decoded view is the view that was linked, not a near miss. Pure: no DOM.
 */

import { CATALOG } from './catalog.js';
import { PATCH_SITES } from './patch.js';

const MODES = ['outlines', 'displacement', 'area', 'angle', 'morph', 'globe'];
const LAYERS = ['relief', 'wrinkle', 'cloth', 'patch', 'arcs'];
const SOURCES = ['area', 'angle', 'strain'];

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

/** A setting stored as one byte: a scale to store it on and the way back. */
const scaled = (factor, offset = 0) => ({
  put: (value) => clampByte(value * factor + offset),
  get: (byte) => (byte - offset) / factor,
});

/** A setting stored as its position in a fixed list. */
const chosen = (list, name = (entry) => entry) => ({
  put: (value) => Math.max(0, list.findIndex((entry) => name(entry) === value)),
  get: (byte) => name(list[byte] ?? list[0]),
});

// The order fixes each field's code, so entries are appended, never reordered:
// a link is only readable by a build that agrees with the one that wrote it.
const FIELDS = [
  ['idA', chosen(CATALOG, (entry) => entry.id)],
  ['idB', chosen(CATALOG, (entry) => entry.id)],
  ['mode', chosen(MODES)],
  ['globeLayer', chosen(LAYERS)],
  ['reliefSource', chosen(SOURCES)],
  ['patchSite', chosen(PATCH_SITES, (site) => site.id)],
  ['rotate', scaled(1 / 5, 36)],
  ['morphT', scaled(200)],
  ['contrast', { put: (v) => clampByte(Math.log2(v) * 4), get: (b) => 2 ** (b / 4) }],
  ['tilt', scaled(100, 100)],
  ['exaggeration', scaled(200)],
  ['foldScale', scaled(100)],
  ['wavelength', scaled(200)],
  ['patchFolds', scaled(10)],
  ['studCount', scaled(1 / 200)],
  ['columns', scaled(1 / 12)],
  ['globeColumns', scaled(1 / 90)],
];

// The checkboxes ride together in one byte rather than costing two each.
const FLAGS = [
  'shadeStrain',
  'morphBare',
  'morphDots',
  'morphCells',
  'morphTiles',
  'morphTissot',
  'morphAnchor',
];
const FLAGS_CODE = FIELDS.length;

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** The view as a hash token, or '' when nothing has moved off the defaults. */
export function encodeState(settings, defaults) {
  const bytes = [];
  FIELDS.forEach(([key, codec], code) => {
    if (settings[key] === undefined || settings[key] === defaults[key]) return;
    bytes.push(code, codec.put(settings[key]));
  });

  if (FLAGS.some((key) => Boolean(settings[key]) !== Boolean(defaults[key]))) {
    let mask = 0;
    FLAGS.forEach((key, bit) => {
      if (settings[key]) mask |= 1 << bit;
    });
    bytes.push(FLAGS_CODE, mask);
  }
  return bytes.length ? toBase64Url(bytes) : '';
}

/**
 * A hash token back into the settings it names. Returns only what the token
 * carried, for the caller to lay over its defaults; anything unreadable comes
 * back empty rather than throwing, because a mangled link should open the app
 * rather than break it.
 */
export function decodeState(token) {
  if (!token) return {};
  const settings = {};
  try {
    const bytes = fromBase64Url(token);
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = bytes[i];
      const value = bytes[i + 1];
      if (code === FLAGS_CODE) {
        FLAGS.forEach((key, bit) => {
          settings[key] = Boolean(value & (1 << bit));
        });
        continue;
      }
      const field = FIELDS[code];
      if (field) settings[field[0]] = field[1].get(value);
    }
  } catch {
    return {};
  }
  return settings;
}
