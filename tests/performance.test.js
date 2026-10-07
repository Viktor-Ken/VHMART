import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatPrice } from '../js/marketplace.js';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('prices are formatted without Intl and read the same as before', () => {
  assert.equal(formatPrice(55000), '₦55,000');
  assert.equal(formatPrice(7000), '₦7,000');
  assert.equal(formatPrice(1234.5), '₦1,234.50');
  assert.equal(formatPrice(1000000), '₦1,000,000');
  assert.equal(formatPrice(0), '₦0');
  assert.equal(formatPrice('7000'), null);
  assert.equal(formatPrice(NaN), null);
  assert.doesNotMatch(read('js/marketplace.js'), /\.toLocaleString\(/);
  assert.doesNotMatch(read('js/products.js'), /\.toLocaleString\(/);
});

test('every product image has a card thumbnail that is much smaller than the original', () => {
  const images = fs.readdirSync(path.join(root, 'product')).filter((name) => /^p\d+--.+\.jpe?g$/i.test(name));
  assert.ok(images.length > 0);
  for (const name of images) {
    const thumb = path.join(root, 'product', 'thumb', `${path.parse(name).name}.webp`);
    assert.ok(fs.existsSync(thumb), `product/thumb is missing a thumbnail for ${name}`);
    assert.ok(fs.statSync(thumb).size < fs.statSync(path.join(root, 'product', name)).size, `${name}: thumbnail is not smaller`);
  }
});

test('the first cards on a page load at once, and static product pages do not lazy-load their main image', () => {
  assert.match(read('js/marketplace.js'), /fetchPriority = "high"/);
  assert.match(read('index.html'), /priority: index < 2/);
  assert.match(read('marketplace.html'), /priority:index<4/);
  assert.match(read('vendor-profile.html'), /priority: index < 3/);
  for (const name of fs.readdirSync(path.join(root, 'product')).filter((n) => n.endsWith('.html'))) {
    const source = read(`product/${name}`);
    assert.match(source, /<img src="\/product\/p[^"]+" alt="[^"]*" width="600" height="600" fetchpriority="high"/, `${name}: main image should be high priority`);
  }
});

test('the marketplace reserves a screen of height so the footer does not jump when products arrive', () => {
  assert.match(read('marketplace.html'), /main\.page\{min-height:100vh\}/);
});

test('the product page renders before it loads Firebase', () => {
  const page = read('product.html');
  assert.doesNotMatch(page, /^import \{ database \}/m);
  assert.match(page, /import\('\.\/js\/firebase\.js'\)/);
});

test('the publish step ships long cache headers for fonts, images and thumbnails', () => {
  const build = read('scripts/build-publish.js');
  for (const rule of ['/fonts/*', '/Visuamall/*', '/product/thumb/*', '/css/*', '/js/*']) assert.ok(build.includes(rule), `no cache rule for ${rule}`);
  assert.match(build, /max-age=31536000, immutable/);
});
