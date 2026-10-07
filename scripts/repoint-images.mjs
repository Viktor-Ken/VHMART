// Verifies that every local image reference resolves to a file that exists.
//
// Renaming an asset without repointing its references leaves a broken image on a
// page, which no other check would catch: the build only proves the file was
// copied, not that anything still points at it. Excludes release.test.js, which
// names the old paths on purpose to assert they are gone.
//
// Run: node scripts/repoint-images.mjs
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
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

// A URL may percent-encode a space in a filename, as the preload for the header
// background does. The file on disk has the literal space, so the path has to be
// decoded before it can be looked up - otherwise a perfectly valid reference is
// reported as missing.
const onDisk = (rel) => exists(path.join(root, decodeURIComponent(rel)));

let dangling = 0;
for (const file of texts) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(PATTERN)) {
    const rel = match[1];
    if (!(await onDisk(rel))) {
      // A renamed asset keeps its stem, so point at the replacement rather than
      // only reporting it. Deriving this from the filesystem rather than from
      // `git status` matters: once a rename has been committed, git no longer
      // reports the old path as deleted and the reference is missed entirely.
      const decoded = decodeURIComponent(rel);
      const dir = decoded.slice(0, decoded.lastIndexOf('/'));
      const stem = decoded.slice(dir.length + 1).replace(/\.(png|jpe?g|bmp|gif)$/i, '');
      let fixed = false;
      for (const candidate of ['webp', 'avif']) {
        const replacement = `${dir}/${stem}.${candidate}`;
        if (await exists(path.join(root, replacement))) {
          await writeFile(file, text.split(rel).join(replacement), 'utf8');
          console.log(`  FIXED    ${path.relative(root, file)}  ${rel} -> ${replacement}`);
          dangling += 1;
          fixed = true;
          break;
        }
      }
      if (!fixed) {
        console.log(`  MISSING  ${path.relative(root, file)}  ->  ${rel}  (no replacement found)`);
        dangling += 1;
      }
    }
  }
}

console.log(dangling ? `\n${dangling} dangling reference(s) found` : '  every image reference resolves');
process.exitCode = dangling ? 1 : 0;