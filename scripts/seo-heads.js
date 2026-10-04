// Injects canonical URLs, Open Graph / Twitter tags and JSON-LD into the
// hand-written pages. Run after editing any of them:  node scripts/seo-heads.js
//
// The generated product pages in product/ are excluded: build-seo.js writes
// their heads with per-product values already resolved.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SITE_ORIGIN = 'https://vhmart.online';
const SITE_NAME = 'VisuaHealth Market';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/Visuamall/general/home-removebg-preview.png`;

// route is the clean URL the live site serves (static hosts resolve a clean URL
// to the matching .html file). canonical
// must point there, never at the .html file, or the two compete in the index.
const PAGES = {
  'index.html': {
    route: '/',
    title: `${SITE_NAME} | Health, Medical Wear & Wellness Products`,
    description: 'Shop scrubs, masks, wellness and fitness products from independent VHMART vendors. Browse by category, view product details and send an enquiry directly to the vendor.',
    image: `${SITE_ORIGIN}/Visuamall/general/home-removebg-preview.png`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/marketplace?q={search_term_string}` },
        'query-input': 'required name=search_term_string'
      }
    }
  },
  'marketplace.html': {
    route: '/marketplace',
    title: `Marketplace | ${SITE_NAME}`,
    description: 'Browse every product listed on VHMART: health equipment, wellness, fitness, books and more. Filter by category and contact the vendor directly.',
    breadcrumbs: ['/', '/marketplace']
  },
  'categories.html': {
    route: '/categories',
    title: `Product categories | ${SITE_NAME}`,
    description: 'Explore VHMART by category: wellness, hospital and lab equipment, hospital wear, fitness, books, courses and more.',
    breadcrumbs: ['/', '/categories']
  },
  'contact.html': {
    route: '/contact',
    title: `Contact VHMART | Send an enquiry`,
    description: 'Send an enquiry to a VHMART vendor about a product. Get answers on availability, pricing and delivery before you buy.',
    breadcrumbs: ['/', '/contact']
  },
  'vendor.html': {
    route: '/vendor',
    title: `Sell on VHMART | Become a vendor`,
    description: 'List your health, wellness or medical products on VHMART. Apply to become a vendor and reach customers looking for your products.',
    breadcrumbs: ['/', '/vendor'],
    // This page renders one vendor's storefront from ?id=, which build-seo.js
    // cannot enumerate. Index the seller-facing page only.
    noindex: true
  },
  'random.html': {
    route: '/random',
    title: `Random product picks | ${SITE_NAME}`,
    description: 'See randomly selected products from VHMART vendors across health, wellness, fitness and medical equipment.',
    // Every visit shows a different page, so there is nothing stable to rank.
    noindex: true,
    breadcrumbs: ['/', '/random']
  },
  'terms-and-conditions.html': {
    route: '/terms-and-conditions',
    title: `Terms of Use | ${SITE_NAME}`,
    description: 'The terms that apply when you browse VHMART, contact a vendor or list a product on the marketplace.',
    breadcrumbs: ['/', '/terms-and-conditions']
  },
  'login.html': {
    route: '/login',
    title: `Sign in | ${SITE_NAME}`,
    description: 'Sign in to your VHMART account to manage your profile, products and enquiries.',
    noindex: true
  },
  'register.html': {
    route: '/register',
    title: `Create an account | ${SITE_NAME}`,
    description: 'Create a VHMART account to save your details, send enquiries and list products as a vendor.',
    noindex: true
  },
  // Signed-in pages. noindex, because a result page cannot show anything useful
  // to someone who is not already signed in, and the content is account data.
  // A short description is still written so the snippet is never a bare URL.
  'account.html': {
    route: '/account', noindex: true,
    title: `My account | ${SITE_NAME}`,
    description: 'Manage your VHMART profile, products and enquiries.'
  },
  'account-deleted.html': {
    route: '/account-deleted', noindex: true,
    title: `Account unavailable | ${SITE_NAME}`,
    description: 'This VHMART account is unavailable.'
  },
  'vendor/pending.html': {
    route: '/vendor/pending', noindex: true,
    title: `Application status | ${SITE_NAME}`,
    description: 'The status of your VHMART vendor application.'
  },
  'vendor/deleted.html': {
    route: '/vendor/deleted', noindex: true,
    title: `Account unavailable | ${SITE_NAME}`,
    description: 'This VHMART vendor account is unavailable.'
  },
  'vendor/dashboard.html': {
    route: '/vendor/dashboard', noindex: true,
    title: `Vendor dashboard | ${SITE_NAME}`,
    description: 'Manage your VHMART vendor listing, products and enquiries.'
  },
  'vendor/products.html': {
    route: '/vendor/products', noindex: true,
    title: `Your products | ${SITE_NAME}`,
    description: 'The products you have listed on VHMART.'
  },
  'vendor/add-product.html': {
    route: '/vendor/add-product', noindex: true,
    title: `Add a product | ${SITE_NAME}`,
    description: 'List a new product on VHMART.'
  },
  'vendor/edit-product.html': {
    route: '/vendor/edit-product', noindex: true,
    title: `Edit product | ${SITE_NAME}`,
    description: 'Update one of your VHMART product listings.'
  },
  'vendor/enquiries.html': {
    route: '/vendor/enquiries', noindex: true,
    title: `Vendor enquiries | ${SITE_NAME}`,
    description: 'Customer enquiries sent about your VHMART products.'
  },
  'vendor/profile.html': {
    route: '/vendor/profile', noindex: true,
    title: `Vendor profile | ${SITE_NAME}`,
    description: 'Your public vendor profile on VHMART.'
  }
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((route, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: route === '/' ? 'Home' : route.replace(/^\//, '').replace(/-/g, ' '),
      item: `${SITE_ORIGIN}${route}`
    }))
  };
}

function organisationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    logo: `${SITE_ORIGIN}/Visuamall/general/home-removebg-preview.png`
  };
}

// Everything between these markers is ours; the rest of the head is left alone.
const BEGIN = '<!-- seo:start -->';
const END = '<!-- seo:end -->';

function buildBlock(config) {
  const url = `${SITE_ORIGIN}${config.route}`;
  const title = config.title || `${SITE_NAME}`;
  const image = config.image || DEFAULT_IMAGE;
  const lines = [BEGIN];

  lines.push(`<title>${escapeHtml(title)}</title>`);
  if (config.description) lines.push(`<meta name="description" content="${escapeHtml(config.description)}">`);
  lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  lines.push(`<meta name="robots" content="${config.noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}">`);

  lines.push(`<meta property="og:type" content="website">`);
  lines.push(`<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`);
  lines.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
  if (config.description) lines.push(`<meta property="og:description" content="${escapeHtml(config.description)}">`);
  lines.push(`<meta property="og:url" content="${escapeHtml(url)}">`);
  lines.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
  lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  lines.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`);
  if (config.description) lines.push(`<meta name="twitter:description" content="${escapeHtml(config.description)}">`);
  lines.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`);

  const blocks = [organisationJsonLd()];
  if (config.jsonLd) blocks.push(config.jsonLd);
  if (config.breadcrumbs) blocks.push(breadcrumbJsonLd(config.breadcrumbs));
  for (const block of blocks) {
    // </script> inside JSON would end the tag early.
    lines.push(`<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`);
  }

  lines.push(END);
  return lines.join('\n');
}

// Any pre-existing tag of a kind we own is removed before ours goes in.
// Leaving both behind means two descriptions, and Google picks one at random.
const OWNED_TAGS = [
  /<title>[\s\S]*?<\/title>/gi,
  /<meta\s+name="description"\s+content="[^"]*"[^>]*>/gi,
  /<link\s+rel="canonical"\s+href="[^"]*"[^>]*>/gi,
  /<meta\s+name="robots"\s+content="[^"]*"[^>]*>/gi,
  /<meta\s+property="og:(?:type|site_name|title|description|url|image)"[^>]*>/gi,
  /<meta\s+name="twitter:(?:card|title|description|image)"[^>]*>/gi,
  /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi
];

function stripOwned(html) {
  let cleaned = html;
  for (const pattern of OWNED_TAGS) cleaned = cleaned.replace(pattern, '');
  return cleaned;
}

function inject(html, block) {
  const withoutPrevious = html.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), '');
  const cleaned = stripOwned(withoutPrevious);
  const headEnd = cleaned.indexOf('</head>');
  if (headEnd === -1) throw new Error('no </head> found');
  // Removing the previous block leaves the newlines that surrounded it, and
  // those accumulate: without this, every run pushes one more blank line in
  // front of the marker and the files grow forever.
  const before = cleaned.slice(0, headEnd).replace(/\s+$/, '');
  return `${before}\n${block}\n${cleaned.slice(headEnd)}`;
}

let changed = 0;
let missing = 0;
for (const [file, config] of Object.entries(PAGES)) {
  const full = path.join(rootDir, file);
  let html;
  try {
    html = await readFile(full, 'utf8');
  } catch {
    console.log(`SKIP    ${file} (not found)`);
    missing += 1;
    continue;
  }
  const next = inject(html, buildBlock(config));
  if (next !== html) {
    await writeFile(full, next, 'utf8');
    console.log(`updated ${file}`);
    changed += 1;
  } else {
    console.log(`ok      ${file}`);
  }
}

console.log(`\n${changed} page(s) updated, ${Object.keys(PAGES).length - missing} checked.`);
