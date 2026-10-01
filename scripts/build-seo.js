// Regenerates products.json, then writes every SEO artefact that depends on the
// catalogue: robots.txt, sitemap.xml and one static page per product.
//
// Run it before every deploy so the pages Google indexes never lag behind the
// live database:  npm run build:seo
import { writeFile, mkdir, readFile, readdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDir, 'products.json');
const productDir = path.join(rootDir, 'product');
const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://visuamall-a620f-default-rtdb.firebaseio.com';

const SITE_ORIGIN = 'https://vhmart.online';
const SITE_NAME = 'VisuaHealth Market';

async function fetchPublishedProducts() {
  const url = new URL(`${databaseURL}/products.json`);
  url.searchParams.set('orderBy', '"status"');
  url.searchParams.set('equalTo', '"PUBLISHED"');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Database returned HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .map(([id, product]) => ({ id, ...product }))
    .filter((product) => product && product.status === 'PUBLISHED' && product.availability !== 'UNAVAILABLE' && !product.deletedAt);
}

const escapeXml = (value) => String(value).replace(/[<>&'"]/g, (character) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]
));

// Only ids we can safely place in a path and an attribute.
const isSafeId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);

const formatPrice = (price) => {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toLocaleString('en-NG', { maximumFractionDigits: 2 });
};

const absolute = (relative) => `${SITE_ORIGIN}/${relative}`;

// One URL per thing a person could search for. Pages behind a login are left
// out on purpose: they are noindex anyway and would only waste crawl budget.
const STATIC_URLS = [
  { path: '', priority: '1.0', changefreq: 'daily' },
  { path: 'marketplace', priority: '0.9', changefreq: 'daily' },
  { path: 'categories', priority: '0.8', changefreq: 'weekly' },
  { path: 'contact', priority: '0.5', changefreq: 'monthly' },
  { path: 'terms-and-conditions', priority: '0.3', changefreq: 'yearly' },
  // Deliberately absent: /random, /login, /register and /vendor are marked
  // noindex by seo-heads.js, and a sitemap must not list a noindex page.
  // Admin, account and vendor-dashboard pages are excluded for the same reason.
];

const CATEGORY_PRIORITY = {
  wellness: '0.8',
  'hospital-lab-equipment': '0.8',
  'hospital-wears': '0.7',
  fitness: '0.7',
  books: '0.6',
  courses: '0.6',
  'health-travel': '0.6',
  general: '0.5',
  'men-shoes': '0.5',
  'women-shoes': '0.5'
};

async function writeSitemap(products) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [...STATIC_URLS];

  const categoryIds = [...new Set(products.map((product) => product.categoryId).filter(Boolean))];
  for (const categoryId of categoryIds) {
    if (!isSafeId(categoryId)) continue;
    entries.push({
      path: `marketplace?category=${categoryId}`,
      priority: CATEGORY_PRIORITY[categoryId] || '0.6',
      changefreq: 'daily',
      lastmod: today
    });
  }

  for (const product of products) {
    if (!isSafeId(product.id)) continue;
    const lastmod = product.updatedAt ? new Date(product.updatedAt).toISOString().slice(0, 10) : today;
    entries.push({ path: `product/${product.id}`, priority: '0.7', changefreq: 'weekly', lastmod });
  }

  const urls = entries
    .map((entry) => [
      '  <url>',
      `    <loc>${escapeXml(absolute(entry.path))}</loc>`,
      entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : '',
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      '  </url>'
    ].filter(Boolean).join('\n'))
    .join('\n');

  await writeFile(
    path.join(rootDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8'
  );
  return entries.length;
}

// Product images live in the database as base64 data URIs, which are useless to
// a crawler: they cannot be indexed, shared or cached, and they bloat every
// page that embeds one. Extract each to a real file so the markup can point at
// a normal URL that Google can fetch and use for image search.
async function materialiseImage(product, index) {
  if (typeof product.image !== 'string' || !product.image.startsWith('data:')) return null;
  const match = product.image.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const extension = ({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' })[match[1].toLowerCase()] || 'jpg';
  const fileName = `p${index}-${product.id}.${extension}`;
  await writeFile(path.join(productDir, fileName), Buffer.from(match[2].replace(/\s+/g, ''), 'base64'));
  return `product/${fileName}`;
}

function productStructuredData(product, imageUrl, categoryId) {
  const price = formatPrice(product.price);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name || 'VHMART product',
    description: product.description || `${product.name} available from a VHMART vendor.`,
    sku: product.id,
    url: absolute(`product/${product.id}`),
    ...(imageUrl ? { image: [absolute(imageUrl)] } : {}),
    ...(categoryId ? { category: categoryId } : {}),
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: {
      '@type': 'Offer',
      url: absolute(`product/${product.id}`),
      availability: 'https://schema.org/InStock',
      priceCurrency: 'NGN',
      ...(price ? { price } : {}),
      seller: { '@type': 'Organization', name: SITE_NAME }
    }
  };
  return JSON.stringify(data);
}

async function writeProductPages(products) {
  await mkdir(productDir, { recursive: true });

  const written = [];
  let index = 0;
  for (const product of products) {
    if (!isSafeId(product.id)) continue;
    index += 1;
    const imageUrl = await materialiseImage(product, index);
    const title = product.name || 'VHMART product';
    const description = (product.description || `${title} from a VHMART vendor.`).slice(0, 300);
    const price = formatPrice(product.price);
    const url = absolute(`product/${product.id}`);
    const categoryId = product.categoryId || '';
    const vendorLine = product.vendorId
      ? 'Sold by an independent VHMART vendor. Message the vendor directly to ask about this product.'
      : 'Listed on VHMART. Send an enquiry to learn more.';

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)} | ${escapeXml(SITE_NAME)}</title>
<meta name="description" content="${escapeXml(description)}">
<link rel="canonical" href="${escapeXml(url)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${escapeXml(SITE_NAME)}">
<meta property="og:title" content="${escapeXml(title)} | ${escapeXml(SITE_NAME)}">
<meta property="og:description" content="${escapeXml(description)}">
<meta property="og:url" content="${escapeXml(url)}">
${imageUrl ? `<meta property="og:image" content="${escapeXml(absolute(imageUrl))}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${imageUrl ? `<meta name="twitter:image" content="${escapeXml(absolute(imageUrl))}">` : ''}
<script type="application/ld+json">${productStructuredData(product, imageUrl, categoryId)}</script>
<link rel="stylesheet" href="/css/main.css">
</head>
<body class="product-static">
<header class="site-header"><nav class="nav" aria-label="Main navigation"><a class="brand" href="/">VHMART</a><div class="nav-links"><a href="/marketplace">Marketplace</a><a href="/login">Sign in</a></div></nav></header>
<main class="page">
<a href="/marketplace">Back to marketplace</a>
<article class="detail">
${imageUrl ? `  <img src="/${escapeXml(imageUrl)}" alt="${escapeXml(title)}" width="600" height="600" loading="lazy" decoding="async">` : ''}
  <div>
    <h1>${escapeXml(title)}</h1>
    <p class="product-price">${price ? escapeXml(`₦${price}`) : 'Contact vendor for price'}</p>
    <p>${escapeXml(product.description || 'Ask the vendor for more information about this product.')}</p>
    <p><small>${escapeXml([categoryId, product.availability, vendorLine].filter(Boolean).join(' | '))}</small></p>
    <p><a href="/contact">Ask about this product</a></p>
  </div>
</article>
</main>
<footer class="live-footer"><div><strong>${escapeXml(SITE_NAME)}</strong><p>Discover products. View vendors. Send an enquiry.</p></div><div><h2>Additional Links</h2><a href="/">Home</a><a href="/categories">Categories</a><a href="/contact">Contact</a><a href="/terms-and-conditions">Terms of Use</a></div></footer>
<script src="/js/brand-avatar.js"></script>
<script src="/js/theme.js"></script>
<script src="/js/track.js"></script>
</body>
</html>
`;
    // Netlify serves /product/<id> from product/<id>.html via pretty URLs.
    await writeFile(path.join(productDir, `${product.id}.html`), html, 'utf8');
    written.push({ id: product.id, imageUrl });
  }
  return written;
}

async function writeRobots() {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# Nothing here is useful in a search result, and several pages read and write',
    '# the signed-in account. Keeping them out saves crawl budget.',
    'Disallow: /admin/',
    'Disallow: /account',
    'Disallow: /vendor/dashboard',
    'Disallow: /vendor/add-product',
    'Disallow: /vendor/edit-product',
    'Disallow: /vendor/products',
    'Disallow: /vendor/enquiries',
    'Disallow: /vendor/profile',
    'Disallow: /account-deleted',
    'Disallow: /vendor/pending',
    'Disallow: /vendor/deleted',
    '',
    'Sitemap: https://vhmart.online/sitemap.xml',
    ''
  ].join('\n');
  await writeFile(path.join(rootDir, 'robots.txt'), body, 'utf8');
}

// Best-effort crawl notification. Bing's IndexNow endpoint needs no account and
// no API key, so this works from a plain deploy. A failure here is not fatal:
// the sitemap in robots.txt still does the slow, reliable version of this job.
async function notifyIndexNow(entries, { enabled }) {
  if (!enabled) return;
  const key = process.env.INDEXNOW_KEY;
  const host = new URL(SITE_ORIGIN).host;
  if (!key) {
    console.log('IndexNow skipped: set INDEXNOW_KEY to enable crawl notifications.');
    return;
  }
  const urlList = entries.map((entry) => absolute(entry.path));
  try {
    const response = await fetch(`https://api.indexnow.org/indexnow?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, urlList })
    });
    if (response.ok) {
      console.log(`IndexNow: submitted ${urlList.length} URLs (HTTP ${response.status}).`);
    } else {
      console.log(`IndexNow: HTTP ${response.status} - ${(await response.text()).slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`IndexNow: could not reach the endpoint (${error.message}).`);
  }
}

// A product that is unpublished must not keep its page (or its image) around,
// or Google keeps a dead URL in the index pointing at a 200.
// Matches only "<id>.html" and "<n>-<id>.<ext>" — the two shapes this script
// writes — so cleanup can never delete a hand-placed file in product/.
const GENERATED_FILE = /^(?:p\d+)?-?[A-Za-z0-9_-]{1,120}\.(?:html|jpg|png|webp|avif|gif)$/;

async function removeStaleProductFiles(pages) {
  let existing;
  try {
    existing = await readdir(productDir);
  } catch {
    return 0;
  }
  // Keep the page and the image for every product still in the catalogue.
  const keep = new Set();
  for (const page of pages) {
    keep.add(`${page.id}.html`);
    if (page.imageUrl) keep.add(path.basename(page.imageUrl));
  }
  let removed = 0;
  for (const name of existing) {
    if (keep.has(name)) continue;
    // Only touch files this script creates; never anything hand-placed here.
    if (!GENERATED_FILE.test(name)) continue;
    await rm(path.join(productDir, name), { force: true });
    removed += 1;
  }
  return removed;
}

try {
  const products = await fetchPublishedProducts();
  const snapshot = { generatedAt: new Date().toISOString(), count: products.length, products };
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Snapshot written: ${outputPath}`);
  console.log(`Published products: ${products.length}`);

  const pages = await writeProductPages(products);
  console.log(`Static product pages: ${pages.length} written to ${path.relative(rootDir, productDir)}/`);

  const removed = await removeStaleProductFiles(pages);
  if (removed) console.log(`Removed ${removed} stale generated file(s) from ${path.relative(rootDir, productDir)}/.`);

  const urlCount = await writeSitemap(products);
  await writeRobots();
  console.log(`Sitemap written with ${urlCount} URLs.`);
  console.log('robots.txt written.');

  // Verify the static output rather than trusting that it was written.
  if (pages.length) {
    const first = path.join(productDir, `${pages[0].id}.html`);
    await access(first);
    const html = await readFile(first, 'utf8');
    for (const required of ['rel="canonical"', 'application/ld+json', '<h1>', 'og:image']) {
      if (!html.includes(required)) throw new Error(`Static product page is missing ${required}`);
    }
    console.log('Static product page check passed.');
  }

  await notifyIndexNow([...STATIC_URLS, ...pages.map((page) => ({ path: `product/${page.id}` }))], {
    enabled: process.argv.includes('--notify')
  });
} catch (error) {
  console.error('Could not run the SEO build:', error.message);
  process.exit(1);
}
