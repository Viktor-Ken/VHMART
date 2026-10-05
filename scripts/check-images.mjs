#!/usr/bin/env node
// Fails the build when an image is over budget.
//
// This is the half of the image policy that runs every time. optimize-images.mjs
// rewrites assets but needs sharp, which is deliberately not a dependency - the
// publish pipeline has to work with nothing installed. So the conversion is a
// manual step and this check is the automatic one: an oversized image cannot be
// committed, because the next build stops.
//
// The budget is a byte limit, deliberately: reading dimensions needs a decoder and
// would mean a dependency. 120 KB is comfortably under what any of these images
// need at the sizes they render.
//
// Run: node scripts/check-images.mjs

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(root, 'Visuamall');
const BUDGET_BYTES = 120 * 1024;

const offenders = [];
let total = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!/\.(png|jpe?g|bmp|gif)$/i.test(entry.name)) continue;
    const info = await stat(full);
    total += info.size;
    if (info.size > BUDGET_BYTES) {
      offenders.push({ file: path.relative(root, full), size: info.size });
    }
  }
}

await walk(IMAGE_DIR);

if (offenders.length) {
  console.error(`image check failed: ${offenders.length} image(s) over ${Math.round(BUDGET_BYTES / 1024)} KB\n`);
  for (const { file, size } of offenders.sort((a, b) => b.size - a.size)) {
    console.error(`  ${String(Math.round(size / 1024)).padStart(5)} KB  ${file}`);
  }
  console.error('\nFix with:');
  console.error('  npm install --no-save sharp');
  console.error('  node scripts/optimize-images.mjs');
  console.error('  node scripts/repoint-images.mjs');
  console.error('  npm uninstall --no-save sharp');
  process.exitCode = 1;
} else {
  console.log(`image check passed (${Math.round(total / 1024)} KB of raster assets, all under ${Math.round(BUDGET_BYTES / 1024)} KB)`);
}