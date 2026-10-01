// Verifies the generated SEO output before a deploy. Catches the mistakes that
// are invisible in a diff: a sitemap URL with no page behind it, a canonical
// pointing at a .html file that competes with the pretty URL, JSON-LD that does
// not parse, a product page missing its heading.
//
//   npm run seo:check
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const read = (relative) => readFile(path.join(rootDir, relative), 'utf8');

async function exists(relative) {
  try { await access(path.join(rootDir, relative)); return true; } catch { return false; }
}

// A clean URL as Netlify resolves it: /foo -> foo.html or foo/index.html
async function resolves(route) {
  const clean = route.replace(/^\//, '').split('?')[0];
  if (!clean) return await exists('index.html');
  return await exists(`${clean}.html`) || await exists(path.join(clean, 'index.html'));
}

const PUBLIC_PAGES = [
  'index.html', 'marketplace.html', 'categories.html', 'contact.html',
  'vendor.html', 'random.html', 'login.html', 'register.html',
  'terms-and-conditions.html', 'account.html', 'account-deleted.html',
  'vendor/pending.html', 'vendor/deleted.html', 'vendor/dashboard.html',
  'vendor/products.html', 'vendor/add-product.html', 'vendor/edit-product.html',
  'vendor/enquiries.html', 'vendor/profile.html'
];

const SITE_ORIGIN = 'https://vhmart.online';

// 1. robots.txt must exist and point at the sitemap.
if (!await exists('robots.txt')) {
  problems.push('robots.txt is missing. Without it a crawler has no sitemap hint.');
} else {
  const robots = await read('robots.txt');
  if (!/Sitemap:\s*https:\/\/vhmart\.online\/sitemap\.xml/i.test(robots)) {
    problems.push('robots.txt has no Sitemap: line for https://vhmart.online/sitemap.xml');
  }
  if (!/User-agent:\s*\*/i.test(robots)) problems.push('robots.txt has no User-agent group');
  if (/Disallow:\s*\/\s*$/m.test(robots) && !/Allow:\s*\//i.test(robots)) {
    problems.push('robots.txt blocks everything; the site would be invisible.');
  }
}

// 2. Every page needs a canonical and a description.
for (const page of PUBLIC_PAGES) {
  if (!await exists(page)) { notes.push(`${page} not found, skipped`); continue; }
  const html = await read(page);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!canonical) {
    problems.push(`${page}: no rel="canonical"`);
  } else {
    const href = canonical[1];
    if (!href.startsWith(SITE_ORIGIN)) problems.push(`${page}: canonical points off-site (${href})`);
    // The live host serves both /foo and /foo.html. Google must be told which.
    if (/\.html($|\?)/.test(href)) {
      problems.push(`${page}: canonical ends in .html (${href}) — it competes with the clean URL`);
    }
  }

  const isNoindex = /name="robots" content="noindex/.test(html);
  const description = html.match(/<meta name="description" content="([^"]*)"/);
  if (!description) {
    problems.push(`${page}: no meta description`);
  } else if (!isNoindex && (description[1].length < 50 || description[1].length > 320)) {
    // Only pages meant to rank need a full snippet. Padding a noindex page out
    // to hit a length target would just be filler nobody ever reads.
    problems.push(`${page}: meta description is ${description[1].length} chars (aim for 50-320)`);
  }

  if (!/<meta property="og:image"/.test(html)) problems.push(`${page}: no og:image`);
  if (!/<meta property="og:title"/.test(html)) problems.push(`${page}: no og:title`);

  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(block[1]); } catch (error) {
      problems.push(`${page}: invalid JSON-LD (${error.message})`);
    }
  }

  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  if (page !== 'random.html' && h1Count !== 1) {
    problems.push(`${page}: has ${h1Count} <h1> elements, expected exactly 1`);
  }
}

// 3. A page marked noindex must not also be in the sitemap.
const sitemapRaw = await exists('sitemap.xml') ? await read('sitemap.xml') : '';
if (!sitemapRaw) {
  problems.push('sitemap.xml is missing. Run: npm run build:seo');
} else {
  const locations = [...sitemapRaw.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!locations.length) problems.push('sitemap.xml contains no URLs');

  for (const location of locations) {
    if (!location.startsWith(`${SITE_ORIGIN}/`)) {
      problems.push(`sitemap: ${location} is not on ${SITE_ORIGIN}`);
      continue;
    }
    const route = location.slice(SITE_ORIGIN.length);
    if (route.includes('?')) continue; // category filters are reachable, not resolvable as files
    if (!await resolves(route)) {
      problems.push(`sitemap: ${location} has no page behind it`);
    }
  }

  const noindexRoutes = [];
  for (const page of PUBLIC_PAGES) {
    if (!await exists(page)) continue;
    const html = await read(page);
    if (/name="robots" content="noindex/.test(html)) {
      noindexRoutes.push(page.replace(/\.html$/, '').replace(/^index$/, ''));
    }
  }
  for (const route of noindexRoutes) {
    if (locations.some((location) => location === `${SITE_ORIGIN}/${route}` || location === `${SITE_ORIGIN}${route}`)) {
      problems.push(`sitemap lists ${route} but the page is noindex`);
    }
  }

  // 4. Each product page must be self-contained.
  let productPages = [];
  try { productPages = (await readdir(path.join(rootDir, 'product'))).filter((name) => name.endsWith('.html')); } catch { /* none yet */ }
  if (!productPages.length) {
    problems.push('product/ has no generated pages. Run: npm run build:seo');
  }
  const snapshotRaw = await exists('products.json') ? await read('products.json') : '{}';
  let snapshot = { products: [] };
  try { snapshot = JSON.parse(snapshotRaw); } catch { problems.push('products.json is not valid JSON'); }
  const snapshotIds = new Set((snapshot.products || []).map((product) => product.id));
  const pageIds = new Set(productPages.map((name) => name.replace(/\.html$/, '')));

  for (const id of snapshotIds) {
    if (!pageIds.has(id)) problems.push(`product/${id} is in products.json but has no static page`);
  }
  for (const id of pageIds) {
    if (!snapshotIds.has(id)) problems.push(`product/${id}.html is stale; it is not in products.json`);
  }

  for (const name of productPages.slice(0, 5)) {
    const html = await read(path.join('product', name));
    const id = name.replace(/\.html$/, '');
    if (!/<h1>/.test(html)) problems.push(`product/${id}: no <h1> in the static HTML`);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (!canonical) problems.push(`product/${id}: no canonical`);
    else if (canonical[1] !== `${SITE_ORIGIN}/product/${id}`) {
      problems.push(`product/${id}: canonical is ${canonical[1]}, expected ${SITE_ORIGIN}/product/${id}`);
    }
    if (!/name="robots" content="index/.test(html)) problems.push(`product/${id}: not indexable`);
    const structured = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!structured) problems.push(`product/${id}: no Product JSON-LD`);
    else {
      try {
        const data = JSON.parse(structured[1]);
        if (data['@type'] !== 'Product') problems.push(`product/${id}: JSON-LD @type is ${data['@type']}`);
        if (!data.name) problems.push(`product/${id}: JSON-LD has no name`);
        if (!data.offers || !data.offers.price) problems.push(`product/${id}: JSON-LD has no offer price`);
      } catch (error) {
        problems.push(`product/${id}: invalid JSON-LD (${error.message})`);
      }
    }
    const image = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (image) {
      const relative = image[1].replace(`${SITE_ORIGIN}/`, '');
      if (!await exists(relative)) problems.push(`product/${id}: og:image ${relative} is missing from the repo`);
    }
  }

  notes.push(`sitemap lists ${locations.length} URLs, ${pageIds.size} static product pages.`);
}

// 5. Indexing. A page that noindexes itself cannot be submitted for indexing.
let indexedBlocked = 0;
for (const page of PUBLIC_PAGES) {
  if (!await exists(page)) continue;
  const html = await read(page);
  if (/name="robots" content="noindex/.test(html) && /<\meta name="googlebot"/.test(html)) indexedBlocked += 1;
}
if (indexedBlocked) problems.push(`${indexedBlocked} page(s) send conflicting robots directives`);

for (const note of notes) console.log(`note:  ${note}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log('\nSEO check passed.');
