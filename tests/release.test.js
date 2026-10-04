import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const count = (haystack, needle) => haystack.split(needle).length - 1;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('vendor registration creates a pending application that needs admin approval', () => {
  const source = read('vendor/register.html');
  assert.match(source, /role:'vendor'/);
  assert.match(source, /status:'PENDING'/);
  assert.doesNotMatch(source, /status:'ACTIVE'/);
  assert.match(source, /update\(ref\(database,`users\/\$\{uid\}`\)/);
  assert.match(source, /update\(ref\(database,`vendors\/\$\{uid\}`\)/);
  assert.doesNotMatch(source, /vendor_applications/);
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  assert.match(rules.vendors['$id']['.write'], /newData\.child\('status'\)\.val\(\) === 'PENDING'/);
});

test('no client code writes through the database root', () => {
  // Realtime Database rules cascade downwards only, so a multi-path update
  // scoped at the root is refused even when every child path is writable.
  // This silently broke vendor registration, admin approval and account
  // deletion, so it is checked structurally across every client file.
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'tests'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length > 0, 'expected to scan client files');
  const offenders = [];
  const rootWrite = /(?:update|set|remove)\(\s*ref\(database\s*\)\s*[,)]/;
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel.startsWith('scripts/')) continue;
    if (rootWrite.test(fs.readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `these files write through ref(database): ${offenders.join(', ')}`);
});

test('deleted accounts are disabled and kept on record rather than removed', () => {
  const accounts = read('admin/accounts.html');
  assert.match(accounts, /deletedAt/);
  assert.match(accounts, /'Restore'/);
  assert.doesNotMatch(accounts, /remove\(ref\(database, `users/);
  const auth = read('js/auth.js');
  assert.match(auth, /userProfile\.deletedAt/);
  assert.match(auth, /account-deleted\.html/);
});

test('visitor analytics is collected and reported to admins', () => {
  const analytics = read('js/analytics.js');
  assert.match(analytics, /analytics\/daily/);
  assert.match(analytics, /analytics\/page_views/);
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  assert.ok(rules.analytics, 'analytics rules missing');
  const pages = ['index.html', 'marketplace.html', 'product.html', 'vendor.html'];
  for (const file of pages) assert.match(read(file), /track\.js/);
  assert.match(read('admin/analytics.html'), /recentTraffic/);
});

test('new vendor products are published immediately', () => {
  const source = read('js/vendor-product-form.js');
  assert.match(source, /status:currentProductStatus/);
  assert.match(source, /let currentProductStatus = 'PUBLISHED'/);
  const rules = JSON.parse(read('firebase/database.rules.json'));
  assert.match(rules.rules.products['$id']['.validate'], /PUBLISHED/);
});

test('public marketplace only requests published products', () => {
  const source = read('js/marketplace.js');
  assert.match(source, /orderByChild\("status"\)/);
  assert.match(source, /equalTo\("PUBLISHED"\)/);
  assert.match(source, /getPublishedProducts/);
});

test('requested unwanted categories and legacy approval states are absent from app source', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(root);
  const banned = [/men['’]?s\s+wear/i, /men['’]?s\s+fitness/i, /women['’]?s\s+wear/i, /women['’]?s\s+fitness/i, /men-wear/i, /men-fitness/i, /women-wear/i, /women-fitness/i];
  for (const file of files) {
    if (!/\.(html|js|json|css|md)$/.test(file)) continue;
    if (path.relative(root, file).split(path.sep).join('/') === 'tests/release.test.js') continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${file} contains ${pattern}`);
  }
  assert.equal(fs.existsSync(path.join(root, 'Visuamall/general/Gym fitness')), false);
});

test('security rules enforce published public reads and owner-scoped vendor queries', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  assert.match(rules.products['.read'], /query\.orderByChild === 'status'/);
  assert.match(rules.products['.read'], /query\.equalTo === 'PUBLISHED'/);
  assert.match(rules.products['.read'], /auth != null/);
  assert.match(rules.enquiries['.read'], /query\.orderByChild === 'vendorId'/);
});

test('a user can soft-delete their own account without privilege escalation', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules.users['$uid'];
  const write = rules['.write'];
  // The old rule only allowed writes when !data.exists(), which blocked every
  // profile update and the self-delete flow for existing accounts.
  assert.match(write, /auth\.uid === \$uid && data\.exists\(\)/, 'self-update of an existing account must be allowed');
  assert.match(write, /newData\.child\('email'\)\.val\(\) === data\.child\('email'\)\.val\(\)/, 'self-update must not change email');
  assert.match(write, /newData\.child\('role'\)\.val\(\) === data\.child\('role'\)\.val\(\)/, 'self-update must not change role');
  assert.match(write, /data\.child\('active'\)\.val\(\) === true \|\| newData\.child\('active'\)\.val\(\) === false/, 'self-update must not reactivate a disabled account');
  assert.match(write, /!data\.child\('deletedAt'\)\.exists\(\) \|\| newData\.child\('deletedAt'\)\.exists\(\)/, 'self-update must not clear an existing deletion');
  assert.match(rules['.validate'], /auth\.token\.email === 'admin@vhmart\.com'/, 'admin must be able to validate records they do not own');
});

test('self-delete disables the account and cannot be blocked by the audit trail', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  const account = read('account.html');
  // The account is written first at its own path, then the audit entry is
  // written best-effort: a denied audit write must not be reported as a
  // failed deletion.
  assert.match(account, /updates\.push\(\[`users\/\$\{user\.uid\}`/);
  assert.match(account, /for \(const \[path, value\] of updates\)/);
  assert.match(account, /audit_logs/);
  const auditIndex = account.indexOf('audit_logs');
  assert.ok(auditIndex > 0, 'expected an audit entry');
  const auditBlock = account.slice(Math.max(0, auditIndex - 120), auditIndex + 400);
  assert.match(auditBlock, /try\s*\{/, 'the audit write must be guarded');
  assert.match(auditBlock, /catch\s*\(/, 'the audit write must have a catch');
  assert.match(auditBlock, /console\.warn/, 'a failed audit write must not throw');
  const selfAudit = rules.audit_logs['$id']['.write'];
  assert.match(selfAudit, /auth\.token\.email === 'admin@vhmart\.com'/, 'admin keeps full audit access');
  assert.match(selfAudit, /newData\.child\('actor'\)\.val\(\) === auth\.uid/, 'a user may only log an entry about themselves');
  assert.match(selfAudit, /newData\.child\('action'\)\.val\(\) === 'self_delete_user'/, 'a user may not forge arbitrary audit actions');
  assert.match(selfAudit, /!data\.exists\(\)/, 'existing audit entries must stay immutable to non-admins');
  assert.match(rules.audit_logs['.read'], /admin@vhmart\.com/, 'audit log must stay admin-only');
});

test('admin approval, suspension and restore can write to a user record', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  // An admin editing another user's record fails validation unless the email
  // comparison is bypassed, which blocked approve/decline/suspend/delete/restore.
  const validate = rules.users['$uid']['.validate'];
  assert.match(validate, /admin@vhmart\.com \|\||auth\.token\.admin/, 'admin write must bypass the owner email check');
  assert.match(rules.users['$uid']['.write'], /auth\.token\.admin === true|admins/, 'admin must retain full write access');
});

test('analytics counters are race-free and do not expose visitor ids', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules.analytics;
  const source = read('js/analytics.js');

  // Views must use a transaction, not read-then-write, or concurrent visitors lose counts.
  assert.match(source, /runTransaction\(/, 'page views must be counted with a transaction');
  assert.doesNotMatch(source, /snapshot\.seen/, 'visitor ids must not be stored in a publicly readable node');
  assert.match(rules.daily['$day'].views['.validate'], /newData\.val\(\) <= data\.val\(\) \+ 1/, 'counter may only ever increment by one');

  // Unique visitors use a visitor-keyed blind write so dedup needs no read.
  assert.match(source, /analytics\/unique\/\$\{day\}\/\$\{id\}/, 'unique visitors must use a visitor-keyed path');
  assert.match(rules.unique['$day']['$visitorId']['.validate'], /newData\.val\(\) === true/, 'unique marker must be a plain true');
  assert.doesNotMatch(rules.unique['$day']['$visitorId']['.read'] || '', /true/, 'visitor ids must not be publicly readable');
  assert.match(rules.unique['.read'], /admin@vhmart\.com/, 'only admins may read the unique visitor list');

  // Analytics day keys must be date-shaped so junk nodes cannot be created.
  assert.match(rules.daily['$day']['.write'], /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);
});

test('every public page declares one canonical, one description and valid JSON-LD', () => {
  const pages = [
    'index.html', 'marketplace.html', 'categories.html', 'contact.html',
    'terms-and-conditions.html', 'random.html', 'login.html', 'register.html'
  ];
  for (const page of pages) {
    const html = read(page);
    assert.equal(count(html, '<title>'), 1, `${page} must have exactly one title`);
    assert.equal(count(html, 'name="description"'), 1, `${page} must have exactly one description`);
    assert.equal(count(html, 'rel="canonical"'), 1, `${page} must have exactly one canonical`);
    assert.match(html, /<link rel="canonical" href="https:\/\/vhmart\.online\//, `${page} canonical must be absolute`);
    assert.doesNotMatch(html, /rel="canonical" href="[^"]*\.html"/, `${page} canonical must not end in .html`);

    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(block[1]), `${page} has invalid JSON-LD`);
    }
  }
});

test('pages behind a login are kept out of search results', () => {
  const privatePages = [
    'account.html', 'account-deleted.html',
    'vendor/pending.html', 'vendor/deleted.html', 'vendor/dashboard.html',
    'vendor/products.html', 'vendor/add-product.html', 'vendor/edit-product.html',
    'vendor/enquiries.html', 'vendor/profile.html'
  ];
  for (const page of privatePages) {
    assert.match(read(page), /name="robots" content="noindex,nofollow"/, `${page} must be noindex`);
  }
});

test('a sitemap exists and only lists pages that are actually indexable', () => {
  const robots = read('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/vhmart\.online\/sitemap\.xml/, 'robots.txt must advertise the sitemap');
  assert.doesNotMatch(robots, /^Disallow:\s*\/$/m, 'robots.txt must not block the whole site');

  const sitemap = read('sitemap.xml');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locations.length >= 10, `expected a populated sitemap, found ${locations.length}`);
  for (const location of locations) {
    assert.ok(location.startsWith('https://vhmart.online/'), `${location} must be on the live origin`);
    assert.doesNotMatch(location, /\.html$/, `${location} must use the clean URL the site serves`);
  }
  assert.ok(locations.includes('https://vhmart.online/'), 'the homepage must be listed');

  // A sitemap entry for a noindex page cancels itself out.
  for (const page of ['random', 'login', 'register', 'account', 'vendor/dashboard']) {
    assert.ok(
      !locations.includes(`https://vhmart.online/${page}`),
      `/${page} is noindex and must not be in the sitemap`
    );
  }
});

test('product pages are readable without JavaScript', () => {
  const directory = path.join(root, 'product');
  assert.ok(fs.existsSync(directory), 'product/ must exist; run npm run build:seo');
  const pages = fs.readdirSync(directory).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length > 0, 'no generated product pages found');

  const snapshot = JSON.parse(read('products.json'));
  const snapshotIds = snapshot.products.map((product) => product.id);
  assert.equal(pages.length, snapshotIds.length, 'every published product needs a page, and no others');

  for (const name of pages) {
    const id = name.replace(/\.html$/, '');
    const html = fs.readFileSync(path.join(directory, name), 'utf8');
    assert.match(html, /<h1>[^<]+<\/h1>/, `${name} needs a real heading in the HTML`);
    assert.match(html, new RegExp(`rel="canonical" href="https://vhmart\\.online/product/${escapeRegExp(id)}"`), `${name} canonical must be its own clean URL`);
    assert.match(html, /name="robots" content="index,follow/, `${name} must be indexable`);

    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, `${name} needs Product structured data`);
    const data = JSON.parse(block[1]);
    assert.equal(data['@type'], 'Product');
    assert.ok(data.name, `${name} JSON-LD needs a name`);
    assert.ok(data.offers && data.offers.price, `${name} JSON-LD needs a price`);
  }
});

test('catalogue links point at the crawlable product pages', () => {
  const marketplace = read('js/marketplace.js');
  assert.match(marketplace, /product\/\$\{encodeURIComponent\(product\.id\)\}/, 'cards must link to the static page');
  assert.doesNotMatch(marketplace, /product\.html\?id=/, 'the ?id= page is JS-only and must not be the link target');

  // The ?id= page still exists for old links, so it must hand the crawler over.
  const detail = read('product.html');
  assert.match(detail, /link\[rel="canonical"\]/, 'product.html must redirect the canonical to the static page');
});

test('login routes admins to the dashboard regardless of how access was granted', () => {
  const login = read('login.html');
  assert.match(login, /import \{ isAdmin \} from '\.\/js\/auth\.js'/, 'login must use the shared admin check');
  assert.match(login, /if\s*\(await isAdmin\(credential\.user\)\)/, 'email sign-in must honour the admin check');
  assert.match(login, /if\s*\(await isAdmin\(user\)\)/, 'google sign-in must honour the admin check');
  // A hardcoded email would lock out anyone granted access from the admin page.
  assert.doesNotMatch(login, /admin@vhmart\.com/, 'login must not gate on a hardcoded admin email');
  assert.doesNotMatch(login, /email\)\.toLowerCase\(\)\s*===/, 'login must not compare emails directly');
});

test('admin pages are gated by the shared requireAdmin helper', () => {
  const auth = read('js/auth.js');
  assert.match(auth, /export function requireAdmin/, 'requireAdmin must be exported');
  assert.match(auth, /profile\.role !== 'admin'/, 'requireAdmin must refuse non-admins');

  // admin/dashboard.html gates through startAdmin(); every other admin page must
  // call requireAdmin directly. An inline role check is no longer enough.
  const pages = ['analytics', 'vendors', 'accounts', 'products', 'reports', 'categories'];
  for (const page of pages) {
    const source = read(`admin/${page}.html`);
    assert.match(source, /import \{ requireAdmin[^}]*\} from '\.\.\/js\/auth\.js'/, `${page}.html must import requireAdmin`);
    assert.ok(source.includes('requireAdmin('), `${page}.html must call requireAdmin`);
    assert.doesNotMatch(source, /requireUser\(/, `${page}.html must not use the weaker requireUser gate`);
    assert.doesNotMatch(source, /role\s*!==\s*'admin'/, `${page}.html must not gate inline`);
  }
  const admin = read('js/admin.js');
  assert.match(admin, /import \{ requireAdmin/, 'startAdmin must use requireAdmin');
  assert.doesNotMatch(admin, /profile\.role !== 'admin'/, 'the inline gate should be gone from startAdmin');
});

test('admin access can be granted and revoked from the admin accounts page', () => {
  const accounts = read('admin/accounts.html');
  assert.match(accounts, /Grant admin access/, 'there must be a grant control');
  assert.match(accounts, /Remove admin access/, 'there must be a revoke control');
  assert.match(accounts, /loadAdmins/, 'there must be an admin list view');
  assert.match(accounts, /data-filter="admins"/, 'there must be an Admin access tab');
  // A grant must record who it was for, and be audited.
  assert.match(accounts, /admins\/\$\{id\}`\), \{ email: account\.email/, 'grant must write the admins node');
  assert.match(accounts, /log\('grant_admin'/, 'granting admin must be audited');
  assert.match(accounts, /log\('revoke_admin'/, 'revoking admin must be audited');
  // Users must never be able to promote themselves through this page.
  assert.doesNotMatch(accounts, /role:\s*'admin'/, 'must not write a role field');
});

test('admin access is honoured by the database rules, not only the UI', () => {
  const rules = JSON.parse(read('firebase/database.rules.json')).rules;
  // Every privileged branch must accept the claim and the admins node, not just
  // one hardcoded email. A UI-only admin is useless and misleading.
  const privileged = JSON.stringify(rules).match(/auth\.token\.admin === true/g) || [];
  assert.ok(privileged.length >= 20, `expected admin checks across the rules, found ${privileged.length}`);
  const adminsNode = JSON.stringify(rules).match(/root\.child\('admins'\)\.child\(auth\.uid\)\.exists\(\)/g) || [];
  assert.ok(adminsNode.length >= 20, `expected admins-node checks across the rules, found ${adminsNode.length}`);
  assert.ok(rules.admins, 'the admins node must have its own rules');
  assert.match(rules.admins['$uid']['.write'], /\$uid !== auth\.uid/, 'admins must not edit their own entry');
  assert.match(rules.admins['$uid']['.write'], /!root\.child\('admins'\)\.exists\(\)/, 'bootstrap must be first-run only');
  assert.match(rules.admins['.read'], /admin@vhmart|admins/, 'the admin list must not be public');

  const auth = read('js/auth.js');
  assert.match(auth, /token\.claims\.admin === true/, 'the client must honour the claim');
  assert.match(auth, /admins\/\$\{user\.uid\}/, 'the client must honour the admins node');
});

test('the analytics page is linked from the admin navigation', () => {
  const dashboard = read('admin/dashboard.html');
  assert.match(dashboard, /href="analytics\.html"/, 'analytics must be reachable from the admin nav');
  assert.match(dashboard, /href="accounts\.html"/, 'accounts must be reachable from the admin nav');
  const analytics = read('admin/analytics.html');
  assert.match(analytics, /recentTraffic/, 'the page must load traffic data');
  assert.match(analytics, /analytics\/page_views/, 'and the page-view events');
});

test('the homepage is counted and the tracker resolves from nested pages', () => {
  const source = read('js/analytics.js');
  assert.doesNotMatch(source, /route === '\/'/, 'the homepage must not be excluded from traffic');
  const track = read('js/track.js');
  assert.match(track, /document\.currentScript\.src/, 'tracker must resolve analytics.js relative to itself');
  assert.doesNotMatch(track, /import\('\.\/analytics\.js'\)/, 'a bare relative import breaks under /admin/ and /vendor/');
    assert.match(read('admin/analytics.html'), /analytics\/page_views/, 'admin must read the analytics-scoped node');
    assert.doesNotMatch(read('admin/analytics.html'), /ref\(database, 'page_views'\)/, 'admin must not read an unscoped node');
  });

  test('the SEO head injection is idempotent', () => {
    // inject() used to delete its own marker block but leave the newlines
    // around it, so every run pushed one more blank line in front of
    // <!-- seo:start --> and the files grew forever. The drift is invisible in
    // a single run and only shows up when you regenerate twice.
    const pages = ['index.html', 'marketplace.html', 'categories.html', 'contact.html',
      'vendor.html', 'random.html', 'terms-and-conditions.html', 'login.html',
      'register.html', 'account.html', 'account-deleted.html',
      'vendor/pending.html', 'vendor/deleted.html', 'vendor/dashboard.html',
      'vendor/products.html', 'vendor/add-product.html', 'vendor/edit-product.html',
      'vendor/enquiries.html', 'vendor/profile.html'];
    for (const page of pages) {
      const source = read(page);
      assert.equal(count(source, '<!-- seo:start -->'), 1, `${page} must have exactly one start marker`);
      assert.equal(count(source, '<!-- seo:end -->'), 1, `${page} must have exactly one end marker`);
      assert.doesNotMatch(source, /(\r?\n){2,}<!-- seo:start -->/,
        `${page} has accumulated blank lines before the marker: a regeneration is not idempotent`);
    }
    const injector = read('scripts/seo-heads.js');
    assert.match(injector, /replace\(\/\\s\+\$\/, ''\)/,
      'inject() must trim the whitespace left behind when it removes the previous block');
  });

  test('the SEO build does not dirty the working tree when nothing changed', () => {
    // build-seo.js used to rewrite products.json with a fresh wall-clock
    // generatedAt and stamp every category sitemap entry with today's date, so
    // `npm run build:seo` always left modified files behind. That makes a CI
    // build look dirty on every run and buries real changes in noise.
    const build = read('scripts/build-seo.js');

    assert.match(build, /async function writeIfChanged\(/,
      'output must be written only when the content actually differs');
    assert.match(build, /current\.equals\(next\)/,
      'writeIfChanged must compare bytes before writing');

    // The stamp has to survive when the catalogue is untouched.
    assert.match(build, /Catalogue unchanged: keeping the existing generatedAt/,
      'an unchanged catalogue must keep its generatedAt stamp');
    assert.match(build, /previousBody === serialisedBody/,
      'generatedAt must be reused only when the product data is identical');

    // Category pages must be dated from their products, not from the clock.
    // Asserting the helper exists is not enough: it has to be the value the
    // category entry actually receives, otherwise the definition can sit there
    // unused while every entry is still stamped with the build date.
    assert.match(build, /function lastmodFrom\(/,
      'lastmod must be derived from product data');
    assert.match(build, /lastmod:\s*lastmodFrom\(products,\s*\(product\)\s*=>\s*product\.categoryId === categoryId,\s*today\)/,
      'a category entry must take its lastmod from its newest product, not from today');

    // Line endings must not manufacture a phantom diff.
    const attributes = read('.gitattributes');
    assert.match(attributes, /products\.json text eol=lf/,
      'products.json must be checked out with the endings the build writes');
    assert.match(attributes, /sitemap\.xml text eol=lf/,
      'sitemap.xml must be checked out with the endings the build writes');
  });

  test('every password field can be shown and hidden', () => {
    // The eye control was missing from sign-in. Each page with a password input
    // needs the wrapper, a toggle pointing at the field id, the script, and CSS.
    const pages = ['login.html', 'admin/login.html', 'register.html', 'vendor/register.html'];
    for (const page of pages) {
      const html = read(page);
      assert.match(html, /class="password-field"/, `${page} is missing the password-field wrapper`);
      assert.match(html, /data-password-toggle="password"/, `${page} is missing the visibility toggle`);
      assert.match(html, /js\/password-toggle\.js/, `${page} does not load the toggle script`);
    }

    const toggle = read('js/password-toggle.js');
    // It must flip the type, and keep aria-pressed and the accessible name in
    // step so a screen reader is not told the wrong state.
    assert.match(toggle, /input\.type = revealed \? 'password' : 'text'/, 'the toggle must switch the input type');
    assert.match(toggle, /aria-pressed/, 'the toggle must expose its state');
    assert.match(toggle, /preventDefault\(\)/,
      'the toggle sits inside a <label>, which forwards clicks to its input');
    assert.match(toggle, /data-password-toggle/, 'the script must find its target via the data attribute');

    const css = read('css/main.css');
    assert.match(css, /\.password-toggle\s*\{/, 'the toggle needs styling');
    assert.match(css, /\.password-field input\s*\{[^}]*padding-right/, 'text must not run under the toggle');
  });

  test('an administrator is never labelled a customer', () => {
    // account.html used a two-way ternary, so an admin - whose role comes from
    // the admins node or a custom claim rather than their profile row - fell
    // through to the Customer branch on their own account page.
    const html = read('account.html');
    assert.match(html, /admin:\s*'Administrator'/, 'account.html must map the admin role to a label');
    assert.doesNotMatch(html, /profile\.role === 'vendor' \? 'Vendor' : 'Customer'/,
      'the two-way role check is what mislabelled administrators');
  });

  test('an admin can approve, reject and delete any account, customer or vendor', () => {
    const source = read('admin/accounts.html');

    // Vendors are keyed by the owner's uid, so the page has to read that node
    // too rather than deciding from the users row alone.
    assert.match(source, /get\(ref\(database, 'vendors'\)\)/, 'the page must read vendors to find pending applications');

    assert.match(source, /button\('Approve'/, 'an admin must be able to approve a vendor application');
    assert.match(source, /button\('Reject'/, 'an admin must be able to reject a vendor application');
    assert.match(source, /status: 'ACTIVE'/, 'approval must activate the vendor');
    assert.match(source, /status: 'DECLINED'/, 'rejection must record a decision');

    // Approving a vendor must republish what was only suspended because the
    // application was still pending, otherwise the storefront stays dark.
    assert.match(source, /syncProducts/, 'product visibility must follow the vendor decision');
    assert.match(source, /vendorSuspended: false/, 'approval must clear the pending-suspension flag');

    // Every decision is auditable.
    assert.match(source, /log\('approve_vendor'/, 'approval must be audited');
    assert.match(source, /log\('reject_vendor'/, 'rejection must be audited');
    assert.match(source, /log\('delete_user'/, 'deletion must be audited');

    // Deletion must remain reversible, and must not allow an admin to delete the
    // account they are signed in with.
    assert.match(source, /button\('Restore'/, 'deletion must stay reversible');
    assert.match(source, /if \(id === user\.uid\)/, 'an admin must not be able to delete their own account');
    assert.match(source, /if \(account\.role === 'admin'\) return false/,
      'administrators must be excluded from the manageable list to avoid a lockout');

    // The pending filter is what makes an unapproved application findable.
    assert.match(source, /data-filter="pending"/, 'there must be a pending-approval view');
    assert.match(source, /currentFilter === 'pending'/, 'the pending view must filter on vendor status');
  });

test('the publish folder is the only thing the static host will serve', () => {
    // Uploading a folder publishes its whole contents, which is how the database
    // rules and package.json ended up publicly downloadable. Both .netlifyignore
    // and .gitignore were ignored during that upload. The fix is a staged publish
    // directory plus an assertion over it.
    const wrangler = read('wrangler.toml');
    assert.match(wrangler, /pages_build_output_dir\s*=\s*"public"/,
      'Cloudflare Pages must publish the staged directory, not the repo root');

    // Cloudflare Pages resolves /foo to foo.html, the same way Netlify did, so the
    // internal .html links keep working without a redirect rule. public/ is
    // generated, so it must never be committed.
    assert.match(read('.gitignore'), /^public\/$/m, 'public/ must be gitignored');

    const build = read('scripts/build-publish.js');
    assert.match(build, /EXCLUDED_DIRS/, 'the staging step must exclude directories');
    assert.match(build, /EXCLUDED_FILES/, 'the staging step must exclude individual files');
    assert.match(build, /database\.rules\.json|firebase/, 'the staging step must keep firebase internals out');

    // The cache rule that firebase.json used to carry has to survive the move:
    // Pages does not read firebase.json, so _headers is generated into the output.
    assert.match(build, /_headers/, 'the staging step must emit _headers for Pages');
    assert.match(build, /stale-while-revalidate=300/, 'the products.json cache rule must be preserved');

    // check-publish.js is the regression guard for the exact paths that leaked.
    const check = read('scripts/check-publish.js');
    for (const leak of ['firebase/database.rules.json', 'package.json', 'playwright.config.js']) {
      assert.ok(check.includes(leak), `the publish check must guard ${leak}`);
    }
    // The host config is build metadata, not site content.
    assert.ok(check.includes('wrangler.toml'), 'the publish check must guard wrangler.toml');
    assert.match(check, /process\.exitCode = 1/, 'the publish check must fail the build, not just warn');
  });

  test('the Cloudflare migration is safe to run', () => {
    const setup = read('scripts/cloudflare-setup.mjs');
    const dns = read('scripts/cloudflare-dns.mjs');
    const ns = read('scripts/namecheap-nameservers.mjs');

    // Every migration script must default to changing nothing. These touch DNS
    // and hosting, so an accidental bare run must not be able to write.
    for (const [name, source] of [['cloudflare-setup', setup], ['cloudflare-dns', dns], ['namecheap-nameservers', ns]]) {
      assert.match(source, /--dry-run|--apply/, `${name} must have an explicit apply flag`);
      assert.ok(
        !/process\.argv\.includes\(['"]--apply['"]\)\s*\)?\s*\?\s*true|apply\s*=\s*true/.test(source),
        `${name} must never default to applying changes`
      );
    }

    // Cutting delegation over before Cloudflare serves would take a site that is
    // currently erroring down to one that returns nothing.
    assert.match(ns, /Refusing to switch nameservers/, 'the nameserver change must be gated on the site serving');
assert.match(ns, /cloudflareIsServing/, 'the gate must actually probe the Pages project');
    // Asserting the string "--restore" is not enough: it also appears in the help
    // text, so it would survive the restore path being disabled. Require the flag
    // to be read into the variable the script branches on.
    assert.match(ns, /const\s+restore\s*=\s*process\.argv\.includes\(\s*['"]--restore['"]\s*\)/,
      'the restore path must be driven by a real --restore flag');
    assert.match(ns, /if\s*\(\s*restore\s*\)/, 'the restore path must actually branch on that flag');

// setHosts replaces a whole zone and only works on Namecheap-managed DNS.
    // The domain is on Netlify nameservers, so delegation is the correct change.
    // Check for an actual call, not the word appearing in a comment explaining
    // why it is not used.
    assert.match(ns, /domains\.dns\.setCustom/, 'the nameserver change must use setCustom');
    assert.ok(
      !/call\(\s*['"]namecheap\.domains\.dns\.setHosts['"]/.test(ns),
      'setHosts must not be used to migrate this domain'
    );

    // Mail and verification records must never be deleted by a hosting move.
    assert.match(dns, /protectedTypes/, 'the DNS script must guard non-host records');
    assert.ok(dns.includes("'MX'") && dns.includes("'TXT'"), 'MX and TXT must be explicitly protected');
    assert.match(dns, /never touch|refuses/i, 'the guard must be explained to the operator');

    // A stale publish folder would create a Pages project serving nothing.
    assert.match(setup, /public.*index\.html|index\.html/, 'setup must verify the build output exists first');

    // The verification file keeps Search Console property verification alive.
    assert.match(setup, /verification/i, 'setup must check the Search Console verification file');
  });

  test('published pages contain no mojibake', () => {
    // A UTF-8 character that gets decoded as Latin-1 leaves a stray character in
    // the output. login.html had two, from a middle dot separator rendered as
    // "A-circumflex + middot" instead of "middot". It is visible to users and
// no functional test would catch it, so assert on the code points directly.
    // Read the same public pages that are actually published, rather than
    // shelling out to git: the tests should not depend on the vcs being present.
    const pages = fs.readdirSync(path.join(root), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(html|css|js|json|xml|txt)$/.test(entry.name))
      .map((entry) => entry.name);
    for (const file of ['admin', 'vendor', 'js', 'css', 'product']) {
      const dir = path.join(root, file);
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(html|css|js|json|xml|txt)$/.test(entry.name)) {
          pages.push(`${file}/${entry.name}`);
        }
      }
    }
    assert.ok(pages.length > 0, 'expected to inspect some pages');

    const offenders = [];
    for (const file of pages) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      // U+00C2 immediately before U+00B7 is a UTF-8 middle dot mis-decoded once.
      if (/\u00C2\u00B7/.test(text)) offenders.push(`${file}: mis-decoded middle dot`);
      // A replacement character means bytes that were not valid UTF-8 at all.
      if (text.includes('\uFFFD')) offenders.push(`${file}: U+FFFD replacement character`);
    }
    assert.deepEqual(offenders, [], `encoding damage found:\n${offenders.join('\n')}`);

    // The separator that was broken must still be present, so the fix cannot be
    // "delete the character" and still pass.
    const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
    assert.ok(login.includes('\u00B7'), 'login.html should still use a middle dot separator');
  });

  test('every signed-in page is excluded from search engines', () => {
    // These pages require authentication, but their URLs are public and a
    // crawler that finds one will index the title and description. vendor/
    // already did this; admin/ did not, which left eight admin URLs indexable.
    // A sitemap is not enough on its own: a page absent from the sitemap can
    // still be crawled from an inbound link.
const privateDirs = ['admin', 'vendor', 'account', 'js'];
    const offenders = [];
    let checked = 0;

    // vendor/register.html is deliberately public and indexable: it is the
    // vendor signup page, and vendor.html already targets the /vendor route.
    // Every other page in these directories needs a signed-in session to be
    // useful, so none of them should be indexed.
    const PUBLIC_EXCEPTIONS = new Set(['vendor/register.html']);

    for (const dir of ['admin', 'vendor']) {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) continue;
      for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
        const rel = `${dir}/${entry.name}`;
        if (PUBLIC_EXCEPTIONS.has(rel)) continue;
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        checked += 1;
        if (!/<meta name="robots" content="noindex/.test(text)) {
          offenders.push(`${rel} has no noindex`);
        }
      }
    }

    assert.ok(checked >= 8, `expected to check the admin and vendor pages, checked ${checked}`);
    assert.deepEqual(offenders, [], `indexable signed-in pages:\n${offenders.join('\n')}`);

    // The signup page must stay indexable: over-applying noindex here would
    // quietly remove the vendor landing page from search.
    const signup = fs.readFileSync(path.join(root, 'vendor/register.html'), 'utf8');
    assert.doesNotMatch(signup, /<meta name="robots" content="noindex/,
      'vendor/register.html is a public signup page and must remain indexable');

    // The public pages must stay indexable, or this rule could silently
    // deindex the whole site.
    for (const page of ['index.html', 'marketplace.html', 'categories.html']) {
      const text = fs.readFileSync(path.join(root, page), 'utf8');
      assert.doesNotMatch(text, /<meta name="robots" content="noindex/,
        `${page} is a public page and must remain indexable`);
    }

    // account.html is a signed-in page too.
    const account = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
    assert.match(account, /<meta name="robots" content="noindex/, 'account.html must be noindex');
  });

  test('analytics records visits and only exposes totals to an admin', () => {
    const analytics = read('js/analytics.js');
    const track = read('js/track.js');
    const rules = JSON.parse(read('firebase/database.rules.json')).rules;

    // The tracker must be loaded on the public pages, or nothing is recorded.
    assert.match(track, /trackPageView/, 'track.js must report the page view');
    assert.match(analytics, /analytics\/unique/, 'unique visitors must be counted');
    assert.match(analytics, /analytics\/daily/, 'page views must be counted');
    assert.match(analytics, /runTransaction/, 'the view counter must not lose writes under load');

    // A raw visitor list is personal data. Reading the detail must require an
    // admin; only the aggregate counters may be public.
    assert.match(rules.analytics.page_views['.read'], /auth != null/,
      'the per-visit log must not be publicly readable');
    assert.match(rules.analytics.unique['.read'], /auth != null/,
      'the visitor list must not be publicly readable');
// Assert on the parsed rules for the admin-gated reads, and on the raw JSON for
    // the literal boolean below: JSON.parse turns `"read": true` into the boolean
    // true, which a regex against the parsed object would never match.
    assert.match(rules.analytics.page_views['.read'], /auth != null/,
      'the per-visit log must not be publicly readable');
    assert.match(rules.analytics.unique['.read'], /auth != null/,
      'the visitor list must not be publicly readable');

    const rulesText = read('firebase/database.rules.json');
    const viewsRead = /"views"\s*:\s*\{[^}]*?"\.read"\s*:\s*(true|false)/.exec(rulesText);
    assert.ok(viewsRead, 'expected a .read on the daily views counter');
    assert.equal(viewsRead[1], 'true', 'the daily counter can stay public');

    // Writes are open so anonymous visitors can be counted, so the validation
    // rules are what stop arbitrary data being injected.
    assert.match(rules.analytics.unique['$day']['$visitorId']['.validate'], /newData\.val\(\) === true/,
      'a visitor row may only be the boolean true');
    assert.match(rules.analytics.daily['$day'].views['.validate'], /isNumber/,
      'the view counter must stay a number');

    // The admin report page must be gated, not just hidden.
    const page = read('admin/analytics.html');
    assert.match(page, /requireAdmin/, 'the analytics report must require an admin');
    assert.match(page, /recentTraffic/, 'the analytics report must read the traffic data');
  });
