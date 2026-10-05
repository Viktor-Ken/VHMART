// Verifies that every local image reference resolves to a file that exists.
//
// Renaming an asset without repointing its references leaves a broken image on a
// page, which no other check would catch: the build only proves the file was
// copied, not that anything still points at it. Excludes release.test.js, which
// names the old paths on purpose to assert they are gone.
//
// Run: node scripts/repoint-images.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const texts = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'public'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(html|css|js|mjs)$/i.test(entry.name) && entry.name !== 'release.test.js') texts.push(full);
  }
}
await walk(root);

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

const PATTERN = /(?:\.\/|\/)?(Visuamall\/[^"'()\s<>,;{}]+\.(?:png|jpe?g|webp|avif|gif|svg))/g;

let dangling = 0;
for (const file of texts) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(PATTERN)) {
    const rel = match[1];
    if (!(await exists(path.join(root, rel)))) {
      console.log(`  MISSING  ${path.relative(root, file)}  ->  ${rel}`);
      dangling += 1;
    }
  }
}

console.log(dangling ? `\n${dangling} dangling reference(s)` : '  every image reference resolves');
process.exitCode = dangling ? 1 : 0;