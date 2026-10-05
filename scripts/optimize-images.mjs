#!/usr/bin/env node
// Convert oversized raster images to WebP and cap their dimensions.
//
// This is a maintenance tool, not part of the build. The publish pipeline must
// keep running with nothing installed, so sharp is an opt-in dependency of this
// script only:
//
//     npm install --no-save sharp
//     node scripts/optimize-images.mjs
//     npm uninstall --no-save sharp
//
// scripts/check-images.mjs is the part that runs on every build. It has no
// dependencies and fails the build when an image is over budget, so an oversized
// asset cannot be committed by accident even though nothing here is automatic.
//
// Why WebP: the library held 20 MB of raster images, several of them phone
// photos and PNGs of photographs with alpha. WebP carries alpha and is roughly
// a tenth the size of the equivalent PNG at the same visual quality.
//
// Caps: 1200px on the long edge. Product photography on this site renders at
// 180-600 CSS pixels, so 1200 comfortably covers a 2x display without shipping
// the original camera resolution. An image already inside the budget is left
// alone, so this is safe to re-run.
//
// Existing WebP and AVIF are skipped: they are already compressed, and AVIF
// encoding here would be slow for no gain.

import { readdir, stat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(root, 'Visuamall');
const MAX_EDGE = 1200;
const QUALITY = 80;

// Above this, an image is worth rewriting. Kept in step with check-images.mjs.
// Set at 90 KB rather than the 120 KB the first pass used: that left 59 files
// sitting just under the line as PNG, which is under half the size WebP would
// give for the same image. A budget that only catches the worst offenders is not
// much of a budget.
const BUDGET_BYTES = 90 * 1024;

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif']);

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is not installed. Run:  npm install --no-save sharp');
  process.exit(1);
}

const changed = [];
let beforeTotal = 0;
let afterTotal = 0;

await walk(IMAGE_DIR);

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    // WebP and AVIF are already compressed formats.
    if (!RASTER.has(ext)) continue;
    await convert(full, ext);
  }
}

async function convert(file, ext) {
  const original = await stat(file);
  const info = await sharp(file).metadata();
  const longEdge = Math.max(info.width || 0, info.height || 0);
  if (original.size <= BUDGET_BYTES && longEdge <= MAX_EDGE) return;

  const target = `${file.slice(0, -ext.length)}.webp`;
  // Two source files can reduce to the same stem, e.g. a .png and a .jpg.
  if (target !== file && await exists(target)) {
    console.log(`  skip ${path.relative(root, file)}: ${path.relative(root, target)} already exists`);
    return;
  }

  const pipeline = sharp(file).rotate();
  if (longEdge > MAX_EDGE) pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  const output = await pipeline.webp({ quality: QUALITY }).toFile(`${target}.tmp`);

  // Only replace the original once the new file is written successfully.
  await rename(`${target}.tmp`, target);
  await unlink(file);

  beforeTotal += original.size;
  afterTotal += output.size;
  const saved = Math.round((1 - output.size / original.size) * 100);
  changed.push({ from: original.size, to: output.size });
  console.log(
    `  ${path.relative(root, file).padEnd(52)} ${kb(original.size)} -> ${kb(output.size)}` +
    `  (${saved}% smaller, ${output.width}x${output.height})`
  );
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

console.log(`Optimising images in ${path.relative(root, IMAGE_DIR)} (max edge ${MAX_EDGE}px)\n`);
if (!changed.length) {
  console.log('  nothing over budget');
} else {
  console.log(`\n${changed.length} image(s) rewritten, ${kb(beforeTotal)} -> ${kb(afterTotal)}, saving ${kb(beforeTotal - afterTotal)}`);
  console.log('References to the old filenames still need repointing - check with:');
  console.log('  node scripts/check-images.mjs');
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}