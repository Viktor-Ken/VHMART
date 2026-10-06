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
// would mean a dependency. 90 KB is comfortably under what any of these images
// need at the sizes they render, and it is tight enough to catch a PNG that
// should have been WebP - the first pass used 120 KB and left 59 files just under
// the line.
//
// Run: node scripts/check-images.mjs

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(root, 'Visuamall');
const BUDGET_BYTES = 90 * 1024;

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

// A size budget only judges files that exist. When an image was converted and
// its references were not updated - or a page was reverted to an older version
// while the newer asset was kept - every check passes and the page ships broken
// images. So resolve every reference too.
const SOURCES = ['index.html', 'marketplace.html', 'categories.html', 'contact.html', 'login.html', 'register.html', 'product.html', 'random.html', 'terms-and-conditions.html', 'vendor.html', 'admin', 'vendor', 'js'];
const REFERENCE = /(?:src=|href=|url\(|image\s*:\s*)["']?([^"'\s>)]*\.(?:png|jpe?g|webp|avif|svg|gif))/gi;
const broken = [];

async function checkSource(full) {
  const source = await readFile(full, 'utf8');
  const dir = path.dirname(full);
  for (const match of source.matchAll(REFERENCE)) {
    const raw = match[1];
    if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:')) continue;
    // Strip any query/hash, then decode %20-style escapes: a space in a
    // filename is written %20 in markup but is a literal space on disk.
    const clean = decodeURIComponent(raw.split(/[?#]/)[0]).replace(/^\/+/, '');
    // Image paths are written site-root-relative in most of these files, but a
    // page in a subfolder would resolve them against its own directory. Accept
    // either base so the check cannot fail on a file that is genuinely there.
    const candidates = [path.resolve(dir, clean), path.resolve(root, clean)];
    let found = false;
    for (const target of candidates) {
      if (!target.startsWith(root)) continue;
      try {
        await stat(target);
        found = true;
        break;
      } catch {
        /* try the next base */
      }
    }
    if (!found) broken.push({ source: path.relative(root, full), ref: raw });
  }
}

for (const entry of SOURCES) {
  const full = path.join(root, entry);
  let info;
  try {
    info = await stat(full);
  } catch {
    continue;
  }
  if (info.isDirectory()) {
    for (const child of await readdir(full, { withFileTypes: true })) {
      if (!child.isFile() || !/\.(?:html|js)$/i.test(child.name)) continue;
      await checkSource(path.join(full, child.name));
    }
  } else {
    await checkSource(full);
  }
}

if (offenders.length || broken.length) {
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
  }
  if (broken.length) {
    console.error(`image check failed: ${broken.length} image reference(s) do not exist\n`);
    for (const { source, ref } of broken) {
      console.error(`  ${source}  ->  ${ref}`);
    }
    console.error('\nA missing reference ships as a broken image even though every file is under budget.');
    console.error('Point the reference at the file that exists, or restore the file.');
  }
  process.exitCode = 1;
} else {
  console.log(`image check passed (${Math.round(total / 1024)} KB of raster assets, all under ${Math.round(BUDGET_BYTES / 1024)} KB; every reference resolves)`);
}