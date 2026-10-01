// Notifies Bing (and through it, some other crawlers) that URLs changed.
// Google's own Indexing API is limited to job and livestream pages, so this is
// the workable automated signal for a marketplace.
//
// Two steps, because IndexNow requires proof that you own the site:
//   1. put your key at  https://vhmart.online/<key>.txt
//   2. run:  npm run notify:indexnow
//
// The key file at the repo root is picked up automatically. Set INDEXNOW_KEY to
// override it, which is useful in CI where the key comes from a secret.
//
// Sends the full URL list on demand, or only the products that changed since
// the last run when you pass --changed.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_ORIGIN = 'https://vhmart.online';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// The key lives at the site root as <key>.txt, because IndexNow verifies
// ownership by fetching that file. Reuse it from there rather than asking for it
// to be set again on every deploy.
async function resolveKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY.trim();
  let files;
  try {
    files = await readdir(rootDir);
  } catch {
    return null;
  }
  const candidates = files.filter((name) => /^[A-Za-z0-9-]{8,128}\.txt$/.test(name) && name !== 'robots.txt');
  if (candidates.length === 1) return (await readFile(path.join(rootDir, candidates[0]), 'utf8')).trim();
  return null;
}

const key = await resolveKey();
if (!key) {
  console.error('No IndexNow key found.');
  console.error('Generate one:  node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))"');
  console.error('Save it as <key>.txt in the repo root and re-run.');
  process.exit(1);
}

if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error(`INDEXNOW_KEY looks wrong (${key}). Use 8-128 letters, digits or hyphens.`);
  process.exit(1);
}

// IndexNow caps a single request at 10,000 URLs and asks for batches of that size.
async function readUrls() {
  const sitemap = await readFile(path.join(rootDir, 'sitemap.xml'), 'utf8');
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

async function readChanged() {
  const snapshot = JSON.parse(await readFile(path.join(rootDir, 'products.json'), 'utf8'));
  const stamp = new Date(snapshot.generatedAt || Date.now());
  // Walk back a day so a product touched just before the build is not missed.
  const since = new Date(stamp.getTime() - 24 * 60 * 60 * 1000);
  const urls = [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/marketplace`, `${SITE_ORIGIN}/categories`];
  for (const product of snapshot.products || []) {
    const updated = product.updatedAt ? new Date(product.updatedAt) : null;
    if (updated && updated >= since) urls.push(`${SITE_ORIGIN}/product/${product.id}`);
  }
  return urls;
}

async function post(batch) {
  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(SITE_ORIGIN).host, key, urlList: batch })
  });
  return { status: response.status, body: (await response.text()).slice(0, 300) };
}

const onlyChanged = process.argv.includes('--changed');
let urls;
try {
  urls = onlyChanged ? await readChanged() : await readUrls();
} catch (error) {
  console.error(`Could not read the URL list (${error.message}). Run: npm run build:seo`);
  process.exit(1);
}

if (!urls.length) {
  console.log('Nothing to submit.');
  process.exit(0);
}

console.log(`Submitting ${urls.length} URL(s)${onlyChanged ? ' (changed only)' : ''} to IndexNow.`);
const results = [];
for (let index = 0; index < urls.length; index += 10000) {
  try {
    results.push(await post(urls.slice(index, index + 10000)));
  } catch (error) {
    console.error(`Request failed: ${error.message}`);
    process.exit(1);
  }
}

// 200 = accepted. 202 = received, validation pending. Anything else needs a look.
const accepted = results.filter((result) => result.status === 200 || result.status === 202);
for (const result of results) {
  console.log(`  HTTP ${result.status} ${result.body || '(no body)'.slice(0, 120)}`);
}
if (accepted.length !== results.length) {
  console.error('\nSome batches were rejected. Check that the key file is live at:');
  console.error(`  ${SITE_ORIGIN}/${key}.txt`);
  process.exit(1);
}
console.log('\nIndexNow accepted the submission. Bing typically recrawls within minutes.');
