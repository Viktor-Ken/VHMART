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
  assert.match(page, /import\('\.\/js\/firebase-db\.js'\)/);
});

test('the publish step ships long cache headers for fonts, images and thumbnails', () => {
  const build = read('scripts/build-publish.js');
  for (const rule of ['/fonts/*', '/Visuamall/*', '/product/thumb/*', '/css/*', '/js/*']) assert.ok(build.includes(rule), `no cache rule for ${rule}`);
  assert.match(build, /max-age=31536000, immutable/);
});

test('traffic is recorded over plain HTTPS, with no Firebase SDK on ordinary page views', () => {
  const track = read('js/track.js');
  assert.doesNotMatch(track, /gstatic|import\(/);
  assert.match(track, /firebaseio\.com/);
  assert.match(track, /increment/);
  assert.doesNotMatch(read('js/analytics.js'), /runTransaction|trackPageView/);
});

test('anonymous visitors do not download Firebase just to check for a session', () => {
  const session = read('js/session.js');
  assert.match(session, /!onAuthPage && !hint && storageWorks\(\)/);
  assert.match(read('js/session-core.js'), /provisional hint/);
});

test('Firebase Storage is not loaded, and read-only pages skip the auth SDK', () => {
  assert.doesNotMatch(read('js/firebase.js'), /firebase-storage|getStorage/);
  assert.match(read('js/firebase-db.js'), /getDatabase/);
  assert.doesNotMatch(read('js/firebase-db.js'), /firebase-auth/);
  for (const file of ['vendor-profile.html', 'js/marketplace.js', 'product.html']) assert.match(read(file), /firebase-db\.js/, `${file} should use the database-only module`);
});

test('sign-in pages warm up Firebase and the Google button cannot be clicked before it works', () => {
  for (const file of ['login.html', 'register.html', 'vendor/register.html']) {
    assert.match(read(file), /rel="modulepreload" href="https:\/\/www\.gstatic\.com\/firebasejs\/12\.10\.0\/firebase-auth\.js"/, `${file} does not preload the auth SDK`);
  }
  assert.match(read('login.html'), /id="googleBtn" class="button" type="button" disabled/);
  assert.match(read('login.html'), /googleBtn\.disabled=false;/);
});

test('new vendors are created pending and an administrator can approve or decline them', () => {
  assert.match(read('vendor/register.html'), /status:'PENDING'/);
  const page = read('admin/vendors.html');
  for (const word of ['Pending approval', 'Approve', 'Decline', 'Suspend', 'Reactivate']) assert.match(page, new RegExp(word));
  assert.match(page, /role !== 'admin'/);
  assert.match(read('vendor/dashboard.html'), /Waiting for approval/);
  assert.match(read('js/vendor-product-form.js'), /profile\.status!=='ACTIVE'/);
  const rules = JSON.parse(read('firebase/database.rules.json')).rules.vendors['$id']['.write'];
  assert.match(rules, /newData\.child\('status'\)\.val\(\) === 'PENDING'/, 'rules must let a vendor create only a pending record');
});
