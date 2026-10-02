// Stage the exact set of files that may be published, then let Netlify serve
// only that folder.
//
// Why this exists: `netlify deploy` ignores both .netlifyignore and .gitignore
// when it uploads from a directory. Verified against the live site - these all
// returned HTTP 200 while listed in one file or the other:
//
//   /firebase/database.rules.json   (listed in .netlifyignore)
//   /package.json                   (listed in .netlifyignore)
//   /package-lock.json              (listed in .netlifyignore)
//   /scripts/seo-check.js           (listed in .netlifyignore)
//   /MIGRATION_GUIDE.md             (listed in .gitignore)
//
// The deploy payload is built from the folder contents, so the only reliable
// fix is to publish a directory that contains just the site. That is what this
// script produces, and netlify.toml points publish at it.
//
// Run: node scripts/build-publish.js
// Verify: node scripts/check-publish.js

import { readFile, readdir, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public');

// Directories never copied into the publish output.
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  '.firebase',
  '.netlify',
  'public', // never recurse into our own output
  'tests',
  'scripts',
  'firebase'
]);

// Individual files that must not be published even at the repository root.
const EXCLUDED_FILES = new Set([
  '.firebaserc',
  '.gitignore',
  '.netlifyignore',
  'firebase.json',
  'netlify.toml',
  'package.json',
  'package-lock.json',
  'playwright.config.js',
  'QA_REPORT.md',
  'MVP-AUDIT.md',
  'DEPLOYMENT_CHECKLIST.md',
  'MIGRATION_GUIDE.md',
  'README.md'
]);

const EXCLUDED_EXTENSIONS = new Set(['.docx', '.log', '.map', '.env']);

async function collect(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
      out.push(...(await collect(path.join(dir, entry.name), rel)));
      continue;
    }
    if (!entry.isFile()) continue;

    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (EXCLUDED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    out.push(rel);
  }
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const files = (await collect(root)).sort();

  for (const rel of files) {
    const dest = path.join(OUT, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(root, rel), dest);
  }

  // The SEO build writes generated HTML into the repository root, so those files
  // are copied above. Confirm the essentials survived the copy rather than
  // trusting the walk.
  const required = ['index.html', 'login.html', 'css/main.css', 'js/auth.js', 'sitemap.xml', 'robots.txt'];
  const missing = [];
  for (const rel of required) {
    if (!existsSync(path.join(OUT, rel))) missing.push(rel);
  }
  if (missing.length) {
    throw new Error(`publish output is incomplete, missing: ${missing.join(', ')}. Run "npm run build:seo" first.`);
  }

  const bytes = (await Promise.all(files.map(async (f) => (await stat(path.join(OUT, f))).size)))
    .reduce((a, b) => a + b, 0);

  console.log(`staged ${files.length} files (${(bytes / 1024).toFixed(0)} KB) into public/`);
  console.log('Netlify will now publish public/ only. Run "npm run publish:check" to confirm nothing sensitive is inside.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});