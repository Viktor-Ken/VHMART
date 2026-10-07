import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safeContactUrl, normalisePhone, contactChannels, withPrefilledMessage } from '../js/contact-links.js';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function htmlFiles(dir = '.', found = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'public', 'tests', 'scripts', 'Visuamall', 'fonts', 'firebase'].includes(entry.name)) continue;
    const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) htmlFiles(rel, found);
    else if (entry.name.endsWith('.html')) found.push(rel);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Contact links: what a customer's click ends up opening
// ---------------------------------------------------------------------------

test('phone numbers are turned into international form however they were typed', () => {
  assert.equal(normalisePhone('+2348027187963'), '2348027187963');
  assert.equal(normalisePhone('08027187963'), '2348027187963');
  assert.equal(normalisePhone('+23408027187963'), '2348027187963');
  assert.equal(normalisePhone('8027187963'), '2348027187963');
  assert.equal(normalisePhone('+44 7911 123456'), '447911123456');
  assert.equal(normalisePhone('0044 7911 123456'), '447911123456');
  assert.equal(normalisePhone('12'), null);
  assert.equal(normalisePhone('not a number'), null);
  assert.equal(normalisePhone(''), null);
});

test('WhatsApp and phone links are built from the number', () => {
  assert.equal(safeContactUrl('whatsapp', '08027187963'), 'https://wa.me/2348027187963');
  assert.equal(safeContactUrl('phone', '+234 802 718 7963'), 'tel:+2348027187963');
});

test('a social link must point at that network and be https', () => {
  assert.equal(safeContactUrl('facebook', 'https://facebook.com/vhmart'), 'https://facebook.com/vhmart');
  assert.equal(safeContactUrl('facebook', 'facebook.com/vhmart'), 'https://facebook.com/vhmart');
  assert.equal(safeContactUrl('instagram', '@vhmart'), 'https://www.instagram.com/vhmart');
  assert.equal(safeContactUrl('tiktok', '@vhmart'), 'https://www.tiktok.com/@vhmart');
  assert.equal(safeContactUrl('twitter', 'http://x.com/vhmart'), 'https://x.com/vhmart');
  assert.equal(safeContactUrl('facebook', 'https://evil.example/facebook.com'), null);
  assert.equal(safeContactUrl('instagram', 'https://facebook.com/vhmart'), null);
});

test('hostile or malformed contact values are never turned into links', () => {
  for (const key of ['whatsapp', 'phone', 'email', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'linkedin', 'website']) {
    assert.equal(safeContactUrl(key, 'javascript:alert(1)'), null, `${key} javascript:`);
    assert.equal(safeContactUrl(key, 'data:text/html,<script>alert(1)</script>'), null, `${key} data:`);
    assert.equal(safeContactUrl(key, '   '), null, `${key} blank`);
    assert.equal(safeContactUrl(key, undefined), null, `${key} undefined`);
  }
  assert.equal(safeContactUrl('website', 'ftp://example.com/file'), null);
  assert.equal(safeContactUrl('email', 'a@b.com,c@d.com'), null);
  assert.equal(safeContactUrl('email', 'Name <a@b.com>'), null);
});

test('a website may be any https site, and a bare domain is accepted', () => {
  assert.equal(safeContactUrl('website', 'https://example.com'), 'https://example.com/');
  assert.equal(safeContactUrl('website', 'example.com/shop'), 'https://example.com/shop');
  assert.equal(safeContactUrl('email', 'sales@example.com'), 'mailto:sales@example.com');
});

test('the channel list keeps the intended order and drops anything invalid', () => {
  const channels = contactChannels({
    website: 'https://example.com', facebook: 'https://facebook.com/vhmart', phone: '08027187963',
    whatsapp: '08027187963', instagram: 'javascript:alert(1)', email: 'not an email'
  });
  assert.deepEqual(channels.map((channel) => channel.key), ['whatsapp', 'phone', 'facebook', 'website']);
  assert.deepEqual(contactChannels(null), []);
  assert.deepEqual(contactChannels({}), []);
});

test('the WhatsApp and email handoff carries the product context', () => {
  assert.match(withPrefilledMessage('https://wa.me/2348027187963', 'Hello there'), /^https:\/\/wa\.me\/2348027187963\?text=Hello%20there$/);
  assert.match(withPrefilledMessage('mailto:a@b.com', 'Hi'), /^mailto:a@b\.com\?subject=.*&body=Hi$/);
  assert.equal(withPrefilledMessage('https://facebook.com/vhmart', 'Hi'), 'https://facebook.com/vhmart');
});

// ---------------------------------------------------------------------------
// Password eye toggle
// ---------------------------------------------------------------------------

test('every password field has the eye toggle and loads the script', () => {
  for (const file of htmlFiles()) {
    const source = read(file);
    if (!/type="password"/.test(source)) continue;
    const fields = (source.match(/type="password"/g) || []).length;
    const toggles = (source.match(/data-password-toggle="/g) || []).length;
    assert.equal(toggles, fields, `${file}: ${fields} password field(s) but ${toggles} toggle(s)`);
    assert.match(source, /password-toggle\.js/, `${file} does not load password-toggle.js`);
  }
});

test('forms that contain a toggle disable the submit button, not the toggle', () => {
  for (const file of ['login.html', 'register.html', 'vendor/register.html', 'admin/login.html']) {
    const source = read(file);
    assert.doesNotMatch(source, /form\.querySelector\('button'\)/, `${file} would disable the eye button on submit`);
    assert.match(source, /querySelector\('button\[type="submit"\]'\)/, `${file} should target the submit button`);
  }
});

// ---------------------------------------------------------------------------
// No account page
// ---------------------------------------------------------------------------

test('there is no customer account page and nothing links to one', () => {
  assert.equal(exists('account.html'), false);
  assert.equal(exists('account-deleted.html'), false);
  for (const file of htmlFiles()) {
    assert.doesNotMatch(read(file), /href="\/?account(-deleted)?(\.html)?["?]/, `${file} links to an account page`);
  }
  assert.doesNotMatch(read('robots.txt'), /\/account/);
  assert.doesNotMatch(read('scripts/seo-heads.js'), /'account(-deleted)?\.html'/);
});

// ---------------------------------------------------------------------------
// Product -> vendor profile -> contact / enquiry
// ---------------------------------------------------------------------------

test('the pages the customer journey needs all exist', () => {
  for (const file of ['product.html', 'vendor-profile.html', 'enquiry.html', 'terms-and-conditions.html', 'vendor/enquiries.html', 'js/contact-vendor.js', 'js/contact-links.js', 'js/enquiries.js']) {
    assert.equal(exists(file), true, `${file} is missing`);
  }
});

test('every product page leads to the vendor profile, not straight to contact', () => {
  const dynamic = read('product.html');
  assert.match(dynamic, /vendor-profile\.html\?id=/);
  assert.doesNotMatch(dynamic, /agreeTerms|contact-panel/, 'the terms gate belongs on the vendor profile');

  const pages = fs.readdirSync(path.join(root, 'product')).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length > 0, 'no generated product pages');
  for (const name of pages) {
    const source = read(`product/${name}`);
    assert.match(source, /href="\/vendor-profile\?id=[A-Za-z0-9_-]+&amp;product=/, `product/${name} does not link to the vendor profile`);
    assert.doesNotMatch(source, /\/enquiry\?/, `product/${name} skips the vendor profile`);
    assert.doesNotMatch(source, /track\.js/, `product/${name} loads a script that does not exist`);
  }
});

test('the vendor profile offers contact and enquiry, and contacting needs the terms', () => {
  const profile = read('vendor-profile.html');
  assert.match(profile, /Contact vendor/);
  assert.match(profile, /Make an enquiry/);
  assert.match(profile, /enquiry\.html\?vendor=/);

  const panel = read('js/contact-vendor.js');
  assert.match(panel, /agreeTerms/);
  assert.match(panel, /terms-and-conditions\.html/);
  // The channel can only be opened after the checkbox is ticked.
  assert.match(panel, /if \(!check\.checked\)[\s\S]*?return;[\s\S]*?openChannel\(/);
});

test('an enquiry is saved for the vendor to read', () => {
  const page = read('enquiry.html');
  assert.match(page, /ref\(database, 'enquiries'\)/);
  assert.match(page, /vendor_enquiries\//);
  assert.match(page, /termsAcceptedAt/);
  assert.match(page, /status: 'NEW'/);
  // The rules need a product that belongs to the vendor, so the form must supply one.
  assert.match(page, /productId: product\.id/);

  assert.match(read('vendor/enquiries.html'), /loadVendorEnquiries/);
  assert.match(read('vendor/dashboard.html'), /loadVendorEnquiries/);

  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  assert.match(rules.enquiries['$id']['.write'], /customerUid/);
  assert.match(rules.enquiries['$id']['.validate'], /termsAcceptedAt/);
});

test('the sign-in return path only accepts addresses on this site', () => {
  for (const file of ['login.html', 'register.html']) {
    const source = read(file);
    assert.match(source, /const safeNext=/, `${file} has no safeNext`);
    assert.match(source, /u\.origin!==location\.origin/, `${file} does not check the origin`);
  }
});

// ---------------------------------------------------------------------------
// Links and assets
// ---------------------------------------------------------------------------

test('every link and image in a page points at a file that exists', () => {
  const problems = [];
  for (const file of htmlFiles()) {
    const source = read(file);
    for (const match of source.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      let target = match[1];
      if (/^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(target)) continue;
      target = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!target || target === '/') continue;
      const base = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(file), target);
      const candidates = [base, `${base}.html`, `${base}/index.html`];
      if (!candidates.some((candidate) => exists(candidate))) problems.push(`${file} -> ${match[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});
