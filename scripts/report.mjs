#!/usr/bin/env node
// Numeric comparison of two projections, without opening a browser.
//
//   node scripts/report.mjs mercator robinson
//   node scripts/report.mjs --list

import { CATALOG } from '../src/lib/catalog.js';
import { buildPair, sampleField } from '../src/lib/diff.js';

const args = process.argv.slice(2);

if (args.includes('--list') || args.length === 0) {
  let family = null;
  for (const entry of CATALOG) {
    if (entry.family !== family) {
      family = entry.family;
      process.stdout.write(`\n${family}\n`);
    }
    process.stdout.write(`  ${entry.id.padEnd(24)} ${entry.name}\n`);
  }
  process.stdout.write('\nUsage: node scripts/report.mjs <a> <b>\n');
  process.exit(0);
}

const [idA, idB] = args;
const pair = buildPair({ idA, idB, width: 960, height: 500 });
const { summary, nodes } = sampleField(pair, { columns: 144, rows: 72 });

const num = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

process.stdout.write(`\n${summary.a.name}  vs  ${summary.b.name}\n`);
process.stdout.write(`fitted to 960x500, sampled to +/-${pair.maxLat}deg\n\n`);
process.stdout.write('                        areal (RMS ln)   angular (RMS deg)\n');
process.stdout.write(`  ${summary.a.name.padEnd(22)}${num(summary.a.areal).padStart(12)}${num(summary.a.angular, 2).padStart(20)}\n`);
process.stdout.write(`  ${summary.b.name.padEnd(22)}${num(summary.b.areal).padStart(12)}${num(summary.b.angular, 2).padStart(20)}\n\n`);
process.stdout.write('  displacement between the two maps, in pixels\n');
process.stdout.write(`    median ${num(summary.displacement.median, 1)}   p95 ${num(summary.displacement.p95, 1)}   max ${num(summary.displacement.max, 1)}\n\n`);

// Most projections are symmetric about the equator and the central meridian, so
// the top of a naive ranking is the same disagreement listed four times. One
// entry per latitude band is more informative.
const seen = new Set();
const worst = [];
for (const node of nodes
  .filter((node) => Number.isFinite(node.arealRatio))
  .sort((x, y) => Math.abs(y.arealRatio) - Math.abs(x.arealRatio))) {
  const band = Math.round(Math.abs(node.lat) / 10) * 10;
  if (seen.has(band)) continue;
  seen.add(band);
  worst.push(node);
  if (worst.length === 5) break;
}

process.stdout.write('  widest area disagreement\n');
for (const node of worst) {
  const factor = 2 ** node.arealRatio;
  const direction = factor > 1 ? summary.a.name : summary.b.name;
  process.stdout.write(
    `    ${node.lat.toFixed(0).padStart(4)}deg, ${node.lon.toFixed(0).padStart(5)}deg   ` +
      `${direction} larger by ${num(Math.max(factor, 1 / factor), 2)}x\n`,
  );
}
process.stdout.write('\n');
