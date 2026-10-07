// Fail loudly if the publish output contains anything that must not go public.
//
// A static host uploads whatever is in the publish directory, and a stale public/
// from an earlier run is a real risk. This asserts both halves: every sensitive
// path is absent, and the pages the site needs are present.
//
// Run: node scripts/check-publish.js

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public');

// Anything here returning HTTP 200 on the live site is a disclosure bug.
const FORBIDDEN = [
  'firebase/database.rules.json',
  'firebase.json',
  '.firebaserc',
  'package.json',
  'package-lock.json',
  'playwright.config.js',
  'README.md',
  '.gitignore',
  'wrangler.toml',
  '.node-version',
  // Still guarded even though the Netlify config is gone: these leaked before,
  // and restoring them should not silently reopen that hole.
  '.netlifyignore',
  'netlify.toml',
  'scripts',
  'tests',
  'node_modules',
  '.git',
  'QA_REPORT.md',
  'MIGRATION_GUIDE.md',
  'DEPLOYMENT_CHECKLIST.md'
];

// The site is unusable without these.
const REQUIRED = [
  'index.html',
  'marketplace.html',
  'contact.html',
  'login.html',
  'register.html',
  'vendor.html',
  'vendor-profile.html',
  'enquiry.html',
  'js/contact-vendor.js',
  'js/contact-links.js',
  'js/password-toggle.js',
  'css/main.css',
  'js/auth.js',
  'js/firebase.js',
  'admin/dashboard.html',
  'admin/login.html',
  'robots.txt',
  'sitemap.xml'
];

const problems = [];

for (const rel of FORBIDDEN) {
  if (existsSync(path.join(OUT, rel))) problems.push(`must not be published: ${rel}`);
}

for (const rel of REQUIRED) {
  if (!existsSync(path.join(OUT, rel))) problems.push(`missing from publish output: ${rel}`);
}

if (problems.length) {
  console.error('publish check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`publish check passed (${FORBIDDEN.length} sensitive paths absent, ${REQUIRED.length} required files present)`);
}