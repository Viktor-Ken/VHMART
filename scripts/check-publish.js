// Fail loudly if the publish output contains anything that must not go public.
//
// `netlify deploy` silently uploads whatever is in the publish directory, and a
// stale public/ from an earlier run is a real risk. This asserts both halves:
// every sensitive path is absent, and the pages the site needs are present.
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
  'login.html',
  'account.html',
  'css/main.css',
  'js/auth.js',
  'js/firebase.js',
  'js/password-toggle.js',
  'admin/dashboard.html',
  'admin/accounts.html',
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

// The eye control is easy to lose in a minified page, so assert it survived.
for (const page of ['login.html', 'admin/login.html', 'register.html', 'vendor/register.html']) {
  const file = path.join(OUT, page);
  if (!existsSync(file)) continue;
  const html = await readFile(file, 'utf8');
  if (!html.includes('data-password-toggle="password"')) {
    problems.push(`${page} lost its password visibility control`);
  }
}

// An admin must never be labelled a customer in their own account view.
const accountHtml = await readFile(path.join(OUT, 'account.html'), 'utf8');
if (!accountHtml.includes('Administrator')) {
  problems.push('account.html does not recognise the admin role');
}

if (problems.length) {
  console.error('publish check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`publish check passed (${FORBIDDEN.length} sensitive paths absent, ${REQUIRED.length} required files present)`);
}