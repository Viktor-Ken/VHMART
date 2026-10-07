#!/usr/bin/env node
// Writes a small 4:3 WebP card thumbnail for every product image in product/.
//
// Product cards display an image at roughly 270x200 CSS pixels, but the files in
// product/ are full-size (up to 700px tall, 60-140 KB). A thumbnail is a centre crop
// to the card's own 4:3 shape at 480px wide, usually 10-25 KB, so the home page,
// marketplace and vendor pages download a fraction of the bytes. The browser falls
// back to the full image when a thumbnail does not exist, so this is safe to skip
// or run late.
//
// Maintenance tool, not part of the build (the build runs with nothing installed):
//
//     npm install --no-save sharp
//     npm run thumbs
//     npm uninstall --no-save sharp
//
// Re-run it after the product images change (npm run build:seo rewrites them).

import { readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try { sharp = (await import('sharp')).default; } catch {
  console.error('sharp is not installed. Run: npm install --no-save sharp');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productDir = path.join(root, 'product');
const thumbDir = path.join(productDir, 'thumb');
await mkdir(thumbDir, { recursive: true });

const sources = (await readdir(productDir)).filter((name) => /^p\d+--.+\.(jpe?g|png|webp|avif)$/i.test(name));
const wanted = new Set();
for (const name of sources) {
  const out = `${path.parse(name).name}.webp`;
  wanted.add(out);
  const input = sharp(path.join(productDir, name));
  const { width, height } = await input.metadata();
  const cropW = Math.min(width, Math.round((height * 4) / 3));
  const cropH = Math.min(height, Math.round((width * 3) / 4));
  await input
    .extract({ left: Math.floor((width - cropW) / 2), top: Math.floor((height - cropH) / 2), width: cropW, height: cropH })
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 74 })
    .toFile(path.join(thumbDir, out));
}
// Drop thumbnails whose product image no longer exists.
for (const name of await readdir(thumbDir)) if (!wanted.has(name)) await rm(path.join(thumbDir, name), { force: true });
console.log(`${sources.length} thumbnail(s) written to product/thumb/`);
