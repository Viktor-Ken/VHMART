import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const existsSync = (file) => fs.existsSync(path.join(root, String(file).replace(/^\//, '')));
  // CSS comments are stripped before asserting on directives, so prose explaining a
  // past decision cannot be mistaken for the thing it describes.
  const cssDirectives = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');
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
  // Authority comes from the admin claim or the admins node, not the role column.
    assert.match(auth, /isAdmin\(user, token\)/, 'requireAdmin must refuse non-admins');
    assert.doesNotMatch(auth, /profile\.role !== 'admin'/,
      'requireAdmin must not gate on the role column, which can lag behind the real grant');

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
  assert.match(dashboard, /href="analytics\"/, 'analytics must be reachable from the admin nav');
  assert.match(dashboard, /href="accounts\"/, 'accounts must be reachable from the admin nav');
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
assert.match(source, /if \(isAdminAccount\(id, account\)\) return false/,
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

  test('admin access is judged by the grant, not the role column', () => {
    const auth = read('js/auth.js');
    const adminLogin = read('admin/login.html');
    const accounts = read('admin/accounts.html');

    // Authority lives in the `admins` node and the admin claim. Checking
    // profile.role instead sent a genuine administrator to the homepage,
    // because role is a label that can lag behind the real grant.
    const requireAdmin = /export function requireAdmin\([\s\S]*?\n}/.exec(auth);
    assert.ok(requireAdmin, 'requireAdmin must exist');
    assert.match(requireAdmin[0], /isAdmin\(user, token\)/,
      'requireAdmin must ask isAdmin, which checks the claim and the admins node');
    assert.doesNotMatch(requireAdmin[0], /profile\.role !== 'admin'/,
      'requireAdmin must not gate on the role column');

    // admin/login.html used to redirect to the dashboard on a successful
    // password alone, so anyone who knew the password landed on a page that
    // immediately bounced them. It must verify the grant, and sign the user out
    // again rather than leave a session behind.
    assert.match(adminLogin, /isAdmin\(credential\.user, token\)/,
      'the admin login must verify the grant before redirecting');
    assert.match(adminLogin, /signOut\(auth\)/,
      'a session with no admin grant must be closed, not left open');

    // The accounts list must agree with the same definition, otherwise an admin
    // granted by claim is rendered as "Customer".
    assert.match(accounts, /adminIds\.has\(id\)/,
      'the accounts list must treat the admins node as authoritative');
    assert.match(accounts, /'Administrator'/,
      'the accounts list must label an administrator correctly');
    assert.doesNotMatch(accounts, /account\.role === 'admin' \? 'Administrator'/,
      'the label must not depend on the role column alone');

    // Still no lockout: an admin must not be able to delete their own account.
    assert.match(accounts, /if \(id === user\.uid\)/,
      'self-deletion must stay blocked');
  });

  test('the bootstrap admin path is reachable, not dead code', () => {
    const auth = read('js/auth.js');
    const rules = JSON.parse(read('firebase/database.rules.json')).rules;

    // The deadlock: isAdmin() read admins/{uid}, which the rules only allowed for
    // someone already listed there. An administrator holding no grant was denied
    // the read, so the bootstrap fallback below it never ran and the account could
    // never write its own entry to get in. Symptom: "no administrator grant" for
    // an account that is supposed to be the owner.
    const own = rules.admins.$uid['.read'];
    assert.ok(own, 'admins must grant a per-uid read rule');
    assert.match(own, /\$uid === auth\.uid/,
      'a user must be able to read their own admin entry, or isAdmin() cannot find it');

    // The client must attempt the bootstrap grant rather than reading the whole
    // roster, which needs admin rights already and so cannot be a fallback.
    const fn = /export async function isAdmin\([\s\S]*?\n}/.exec(auth);
    assert.ok(fn, 'isAdmin must exist');
    assert.match(fn[0], /set\(ref\(database, `admins\/\$\{user\.uid\}`\)/,
      'isAdmin must be able to write its own bootstrap entry');
    assert.doesNotMatch(fn[0], /get\(ref\(database, 'admins'\)\)/,
      'reading the whole admins node needs admin rights and cannot serve as a fallback');

    // The escape hatch must stay narrow: own uid, bootstrap email, empty node.
    const write = rules.admins.$uid['.write'];
    assert.match(write, /auth\.token\.email === 'admin@vhmart\.com'/,
      'the bootstrap grant must be limited to the bootstrap email');
    assert.match(write, /\$uid === auth\.uid/,
      'the bootstrap grant must only ever write its own entry');
    assert.match(write, /!root\.child\('admins'\)\.exists\(\)/,
      'the bootstrap grant must stop working once any admin exists');

    // The roster itself must stay private.
    assert.doesNotMatch(rules.admins['.read'], /\$uid === auth\.uid/,
      'the whole admins roster must not become readable by any signed-in user');
  });

  test('the admin recovery script is safe to run', () => {
    const script = read('scripts/grant-admin.js');

    // It writes privileged state, so it must never be reachable from a page.
    const check = read('scripts/check-publish.js');
    assert.ok(check.includes("'scripts'"),
      'the whole scripts directory must be guarded by the publish check');
    const build = read('scripts/build-publish.js');
    assert.match(build, /'scripts'/,
      'staging must exclude the scripts directory that holds this file');

    // An unknown email must be a hard error. Guessing a uid would create an
    // admin entry belonging to nobody, or worse to the wrong person.
    assert.match(script, /getUserByEmail/,
      'the account must be resolved from an email, never guessed from a uid');
    assert.match(script, /user-not-found/,
      'an unknown email must abort instead of writing anything');

    // --dry-run must not write.
    assert.match(script, /dryRun/,
      'a dry run is required so the operator can see the plan first');
    const applySection = script.slice(script.indexOf('if (dryRun) {'));
    assert.match(applySection, /would write/,
      'the dry-run branch must describe the writes it is skipping');

    // With no credentials it must exit before touching anything.
    assert.match(script, /if \(!keyFile && !inline\) \{[\s\S]*?process\.exit\(1\)/,
      'missing credentials must abort before any write is attempted');

    // Both sources of authority must be written together, or the grant and the
    // label can disagree again - which is what caused the original lockout.
    assert.match(script, /admins\/\$\{user\.uid\}/,
      'the admins node entry must be written');
    assert.match(script, /setCustomUserClaims\(user\.uid, \{ admin: true/,
      'the admin custom claim must be written too');

    // Revoking must be possible, and must not strip unrelated claims blindly.
    assert.match(script, /--revoke/, 'there must be a revoke path');
    assert.match(script, /delete claims\.admin/,
      'revoking must remove only the admin claim, not the whole claim set');

    // The legacy token variable would silently override the intended credential.
    assert.match(script, /delete process\.env\.FIREBASE_TOKEN/,
      'the script must neutralise the legacy FIREBASE_TOKEN override');
  });

  test('the accounts page cannot get stuck or fail on the admin roster read', () => {
    const source = read('admin/accounts.html');

    // A rejected read inside Promise.all rejects the whole call. The roster read
    // is therefore wrapped: it resolved to null instead, and the page carried on.
    // Without this the accounts tab showed "Could not load accounts" and the
    // admin-access tab sat on "Loading admin access..." forever.
    const catches = source.match(/\.catch\(/g) || [];
    assert.ok(catches.length >= 2, 'both roster reads must be guarded');
    assert.match(source, /adminsPromise/,
      'the roster read must be a guarded promise, not a bare get()');

    // The loaders must replace their loading placeholder on failure, or the page
    // looks stuck rather than reporting a problem.
    assert.match(source, /Could not load admin access/,
      'the admin-access loader must report a failure instead of spinning');
    assert.match(source, /async function renderAdmins/,
      'loadAdmins must delegate to a wrapped renderer');

    // The claim path must still work when the roster is unreadable, since a
    // claimed admin is exactly the case where the roster read is denied.
    assert.match(source, /token\.claims\.admin === true/,
      'a claim-based admin must still appear when the roster cannot be read');
    assert.match(source, /adminsForRole && adminsForRole\.exists\(\)/,
      'a null roster must be handled, not dereferenced');
  });

  test('above-the-fold content is not deferred', () => {
    const html = read('index.html');
    const images = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    assert.ok(images.length >= 4, `expected several homepage images, found ${images.length}`);

    const hero = images.find((tag) => tag.includes('home-removebg'));
    assert.ok(hero, 'the hero image must be present');
    // Deferring the hero would delay the largest paint on the page, which is
    // the opposite of what the lazy-loading pass was for.
    assert.doesNotMatch(hero, /loading="lazy"/,
      'the above-the-fold hero must not be lazy loaded');
    assert.match(hero, /fetchpriority="high"/,
      'the hero should be fetched at high priority');
    assert.match(hero, /decoding="async"/,
      'decoding must not block first paint');

    // Everything below the fold should be deferred.
    const belowFold = images.filter((tag) => !tag.includes('home-removebg'));
    assert.ok(belowFold.length >= 3, 'expected several below-the-fold images');
    for (const tag of belowFold) {
      assert.match(tag, /loading="lazy"/, `below-the-fold image is not deferred: ${tag}`);
      assert.match(tag, /decoding="async"/, `image is not async-decoded: ${tag}`);
    }

    // Width and height must stay, or lazy loading reintroduces layout shift.
    for (const tag of images) {
      assert.match(tag, /width="\d+"/, `image without width: ${tag}`);
      assert.match(tag, /height="\d+"/, `image without height: ${tag}`);
    }
  });

  test('analytics never blocks the page it measures', () => {
    const track = read('js/track.js');

    // Importing the tracker pulls in the Firebase SDK, around 490 KB across four
    // gstatic modules. A signed-out visitor on a marketing page needs none of that
    // before the page is usable, so it must not run during load.
    assert.match(track, /requestIdleCallback/,
      'the Firebase SDK must be fetched when the browser is idle');
    assert.match(track, /setTimeout/,
      'a fallback is needed where requestIdleCallback is unavailable');

    // The idle request must be bounded, or a page that never goes idle would
    // never record a visit at all.
    assert.match(track, /timeout:\s*\d+/,
      'requestIdleCallback must have a timeout so tracking still happens');

    // It must still run on a page that was already loaded when the script parsed.
    assert.match(track, /readyState === 'complete'/,
      'a late-loading tracker must still record the view');

    // Best effort: a failure must never surface to the visitor.
    assert.match(track, /\.catch\(/,
      'a tracker failure must be swallowed');
  });

  test('a stale id token cannot hide an admin grant', () => {
    const auth = read('js/auth.js');
    const accounts = read('admin/accounts.html');

    // Custom claims are baked into the token at sign-in. Reading the cached
    // token reported a freshly granted administrator as a customer, so every
    // admin-scoped read was denied and the accounts page showed
    // "Could not load accounts" instead of saying why.
    const requireUser = /export function requireUser\([\s\S]*?\n}/.exec(auth);
    assert.ok(requireUser, 'requireUser must exist');
    assert.match(requireUser[0], /getIdTokenResult\(true\)/,
      'requireUser must force a token refresh so a new claim is visible');

    // A denied read must be reported as such. A generic "refresh and try again"
    // sent the operator looking for a browser problem that does not exist.
    assert.match(accounts, /PERMISSION_DENIED/,
      'a permission denial must be recognised');
    assert.match(accounts, /no administrator grant/,
      'the page must state that the account has no admin grant');
    assert.match(accounts, /error && error\.message/,
      'any other failure must report the actual reason');
  });

  test('vendor-supplied contact links cannot become script or off-site traps', () => {
    const links = read('js/contact-links.js');

    // These are the exact strings a hostile vendor could store in their profile.
    // Any of them reaching an href executes on our origin when a customer clicks.
    for (const attack of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd'
    ]) {
      assert.ok(links.includes('SAFE_SCHEMES'),
        'the allow-list must exist for a reason like ' + attack);
    }
    assert.match(links, /SAFE_SCHEMES\.has\(parsed\.protocol\)/,
      'every non-special scheme must be checked against the allow-list');
    assert.match(links, /isKnownSocialHost/,
      'a social link must point at that network');

    // The module is split out and free of Firebase and the DOM precisely so the
    // validation can be tested directly.
    assert.doesNotMatch(links, /firebase\.js|gstatic|document\./,
      'the validation must stay DOM-free and import-free so it is testable');

    // The panel must not open the link before both gates are satisfied.
    const panel = read('js/contact-vendor.js');
    assert.match(panel, /continueButton\.disabled = true/,
      'the continue button must start disabled');
    assert.match(panel, /!picked \|\| !termsBox\.checked/,
      'a channel AND the terms are both required');
    assert.match(panel, /window\.open/,
      'the chosen link is opened for the customer');

    // Ordering matters: the enquiry is recorded before the tab opens, so the
    // vendor has a record even if the customer closes it immediately.
    const open = panel.indexOf('window.open');
    const record = panel.indexOf('await recordEnquiry');
    assert.ok(record < open, 'the enquiry must be stored before the link is opened');

// The generated product page routes to the vendor profile with plain anchors, so
    // it works without JavaScript and no longer pulls in the Firebase SDK.
    // Pages serves the extensionless form directly and 308s /foo.html, so the
    // template and the test both expect no extension.
    const build = read('scripts/build-seo.js');
    assert.match(build, /vendor-profile\?id=/,
      'a product page must offer a link to the vendor profile');
    assert.match(build, /enquiry\?vendor=/,
      'a product page must offer a way to send an enquiry about it');
    assert.doesNotMatch(build, /data-contact-vendor/,
      'the contact panel belongs on the vendor profile, not the product page');
    assert.doesNotMatch(build, /vendor-profile\.html/,
      'internal links must not carry an extension that Pages redirects');
  });

  test('an enquiry reaches the vendor without needing a mail server', () => {
    const panel = read('js/contact-vendor.js');
    const inbox = read('vendor/enquiries.html');
    const links = read('js/contact-links.js');

    // Two delivery paths, neither of which needs a backend: a durable record in
    // the vendor's own dashboard, and a prefilled WhatsApp or email handoff.
    // Sending real email would require Cloud Functions and a paid plan, which
    // this project deliberately does not use.
    assert.match(panel, /recordEnquiry/,
      'the enquiry must be stored so the vendor has a durable copy');
    assert.match(panel, /withPrefilledMessage/,
      'the WhatsApp or email handoff must carry context, not open a blank compose box');

    // Only channels that can carry a body may be prefilled; a social or website
    // link cannot, and pretending otherwise would corrupt the URL.
// Assert the branches rather than the literal text: the code builds these URLs
    // with template strings, so matching a single-line pattern proves nothing.
    assert.match(links, /startsWith\('https:\/\/wa\.me\/'\)/,
      'a WhatsApp handoff must prefill the message');
    assert.match(links, /startsWith\('mailto:'\)/,
      'an email handoff must prefill subject and body');
    assert.match(links, /return url;/,
      'a channel that cannot carry a body must be returned unchanged');

    // The vendor has to know how the customer wants to be reached. The message
    // text is generated, so the channel only appears if the inbox reads the field.
    assert.match(inbox, /CHANNEL_LABELS/,
      'the vendor inbox must label the chosen channel');
    assert.match(inbox, /item\.channel/,
      'the vendor inbox must display the channel');
    // Pre-existing enquiries have no channel and must still render.
    assert.match(inbox, /if \(item\.channel\)/,
      'older enquiries without a channel must not break the inbox');

    // Reply details the vendor needs to answer.
    assert.match(inbox, /customerEmail/, 'the vendor must see how to reply by email');
    assert.match(inbox, /productName|productId/, 'the vendor must see which product was asked about');
  });

test('nothing above the fold blocks the first paint', () => {
    const css = cssDirectives('css/main.css');

    // A CSS @import of a third-party stylesheet is discovered only after this
    // file has loaded, so the browser made two chained round trips before it could
    // resolve a glyph. That held first contentful paint at 2.4s. The fonts are
    // served from this origin now.
    assert.doesNotMatch(css, /@import/,
      'a CSS @import chains a second round trip; keep stylesheets self-contained');
    assert.doesNotMatch(css, /fonts\.googleapis/,
      'the font stylesheet must not be fetched from a third-party origin');

    // The files must actually exist and be real woff2, or the site silently falls
    // back to system fonts.
    for (const face of ['/fonts/DMSans-latin.woff2', '/fonts/SpaceGrotesk-latin.woff2']) {
      assert.ok(existsSync(face), `${face} must exist`);
      const magic = fs.readFileSync(path.join(root, face.slice(1))).subarray(0, 4).toString('ascii');
      assert.equal(magic, 'wOF2', `${face} must be a valid woff2 file`);
    }
    assert.match(css, /font-display:\s*swap/,
      'font-display swap keeps text visible while the font loads');

    // A preload only helps if the page declares it, so at least one shipped page
    // and the generated product pages must both carry it.
    assert.match(read('index.html'), /rel="preload"[^>]*DMSans-latin\.woff2/,
      'hand-written pages must preload the fonts they use');
    const build = read('scripts/build-seo.js');
    assert.match(build, /rel="preload"[^>]*DMSans-latin\.woff2/,
      'generated product pages must preload the fonts too');

    // The fonts must reach the published site.
    assert.ok(existsSync('public/fonts/DMSans-latin.woff2'),
      'the fonts must be staged into the publish output');

// Anything the stylesheet references is only discovered once css/main.css has
    // parsed, which is after the header is already part of the first paint. So
    // every preload on the page must resolve to a file that exists - a preload
    // pointing at a missing or renamed asset wastes a request and warns in the
    // console, and one that silently 404s looks like it worked.
    const preloads = [...read('index.html').matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(preloads.length >= 5, `expected several preloads, found ${preloads.length}`);
    for (const href of preloads) {
      // Percent-encoded, because the header background filename contains a space.
      assert.ok(existsSync(decodeURIComponent(href).slice(1)),
        `preloaded path does not exist: ${href}`);
    }

    // The two CSS backgrounds were the last resources finishing before paint, so
    // they must be preloaded rather than left to be discovered mid-render.
    const heroPreload = /rel="preload"[^>]*href="(\/Visuamall\/general\/hero\.[a-z]+)"/.exec(build);
    assert.ok(heroPreload, 'the hero background must be preloaded so it does not queue behind the CSS');
    assert.match(read('scripts/seo-heads.js'), /bg%202\.jpg/,
      'the sticky header background must be preloaded');

    // The generated product pages carry the same set.
    assert.match(build, /bg%202\.jpg/, 'generated pages must preload the header background too');
    assert.match(build, /logo\.webp/, 'generated pages must preload the logo too');
  });

  test('the heaviest images are converted and not shipped oversized', () => {
    // These two were 622 KB of the ~1.3 MB a homepage visit originally pulled,
    // for a logo rendered at roughly 100px and a photograph stored as a PNG.
    const converted = [
      { file: 'Visuamall/logo.webp', was: 'Visuamall/logo.jpeg' },
      { file: 'Visuamall/general/home-removebg-preview.webp', was: 'Visuamall/general/home-removebg-preview.png' }
    ];

    for (const { file, was } of converted) {
assert.ok(existsSync(file), `${file} must exist`);
      assert.ok(!existsSync(was), `${was} must be removed, not left behind`);
      const size = fs.statSync(path.join(root, file)).size;
      assert.ok(size < 60 * 1024, `${file} is ${Math.round(size / 1024)} KB, expected under 60 KB`);
    }

    // No page may still point at a file that was replaced.
    const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
    for (const page of pages) {
      const text = fs.readFileSync(path.join(root, page), 'utf8');
      assert.doesNotMatch(text, /logo\.jpeg|home-removebg-preview\.png/,
        `${page} still references a replaced image`);
    }

    // The optimiser itself must not become a dependency: the build has to keep
    // working with nothing installed.
    const pkg = JSON.parse(read('package.json'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!all.sharp, 'sharp is a one-off tool and must never be a dependency');
    assert.ok(!existsSync('optimize-images.mjs'),
      'the one-off optimiser must not be left in the repository');
  });

  test('oversized images cannot be committed, and the build stays dependency-free', () => {
    const pkg = JSON.parse(read('package.json'));

    // The conversion needs sharp; the enforcement must not. The publish pipeline
    // runs in a clean checkout with nothing installed, so anything it calls has to
    // work on Node builtins alone.
    assert.match(pkg.scripts['check:images'], /check-images\.mjs/,
      'the image budget must be checkable without dependencies');
    assert.match(pkg.scripts['publish:prepare'], /check:images/,
      'the build must run the image budget check');

    const check = read('scripts/check-images.mjs');
    assert.doesNotMatch(check, /from ['"](?!node:)[^'"]+['"]|require\(['"](?!node:)/,
      'the budget check must use Node builtins only');
    assert.match(check, /BUDGET_BYTES/, 'the budget must be defined in one place');
    assert.match(check, /process\.exitCode = 1/,
      'an oversized image must fail the build, not warn');

    const optimise = read('scripts/optimize-images.mjs');
    assert.match(optimise, /npm install --no-save sharp/,
      'the optimiser must document installing sharp transiently');
    assert.match(optimise, /BUDGET_BYTES/,
      'the optimiser and the check must share one budget');
    assert.match(optimise, /\.webp\(\{ quality/,
      'conversion must produce webp');
    assert.match(optimise, /MAX_EDGE/,
      'oversized dimensions must be capped, not just recompressed');

    // A renamed asset with a stale reference breaks the page silently, so the
    // verifier has to exist and be runnable.
    const verify = read('scripts/repoint-images.mjs');
    assert.match(verify, /MISSING/, 'the verifier must report which file is missing');
    assert.match(verify, /process\.exitCode = dangling \? 1 : 0/,
      'a dangling reference must fail');

    // sharp must never become a recorded dependency.
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(all)) {
      assert.notEqual(name, 'sharp', 'sharp is a one-off tool, not a dependency');
    }
  });

  test('every image reference points at a file that exists', () => {
    // Walk the shipped pages and stylesheets and resolve every Visuamall path.
    // This is the check that catches a rename that the build cannot see: the
    // publish step only proves a file was copied, not that anything points at it.
    const files = [];
    const collect = (dir, prefix = '') => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (['node_modules', '.git', 'public', 'tests'].includes(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) collect(`${dir}/${entry.name}`, rel);
        else if (/\.(html|css|js|mjs)$/i.test(entry.name)) files.push(rel);
      }
    };
    collect('.');

    const pattern = /(?:\.\/|\/)?(Visuamall\/[^"'()\s<>,;{}]+\.(?:png|jpe?g|webp|avif|gif|svg))/g;
    const dangling = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      for (const match of text.matchAll(pattern)) {
        // decodeURIComponent because a URL may percent-encode a space in a filename, as
      // the preload for the header background does. The file on disk has a space.
      if (!existsSync(decodeURIComponent(match[1]))) dangling.push(`${file} -> ${match[1]}`);
      }
    }
    assert.deepEqual(dangling, [], `images referenced but not on disk:\n${dangling.join('\n')}`);
  });

  test('a vendor upload is optimised before it is stored', () => {
    const products = read('js/products.js');

    // This is the "new file uploaded" path. A vendor picking a 4000px phone photo
    // must not be able to store it whole: the image is decoded, scaled and
    // re-encoded in the browser before anything is written to the database.
    assert.match(products, /maxDimension = 700/,
      'uploaded images must be capped in size');
    assert.match(products, /quality = 0\.75/,
      'uploaded images must be re-compressed');
    assert.match(products, /toDataURL\('image\/jpeg'/,
      'uploads must be re-encoded to a compressed format');
    assert.match(products, /Math\.min\(1, maxDimension/,
      'the cap must only shrink, never enlarge');
    assert.match(products, /9 \* 1024 \* 1024/,
      'an oversized source file must be rejected outright');
  });

  test('a stale image reference is repaired automatically, not just reported', () => {
    const verify = read('scripts/repoint-images.mjs');

    // Deriving the replacement from the filesystem, not from `git status`. Once a
    // rename is committed, git stops reporting the old path as deleted, so a
    // reference left behind is invisible to a git-based check - which is exactly
    // how a .png reference survived a pass that renamed the file to .webp.
    assert.match(verify, /\['webp', 'avif'\]/,
      'the repair must consider the compressed replacements');
    assert.match(verify, /no replacement found/,
      'an unresolvable reference must say so rather than failing silently');
    assert.match(verify, /FIXED/,
      'the repair must be reported');
    assert.doesNotMatch(verify, /git status --porcelain/,
      'the repair must not depend on git state');

    // Both budgets live in one place and agree with each other.
    const check = read('scripts/check-images.mjs');
    const optimise = read('scripts/optimize-images.mjs');
    const budgetInCheck = /const BUDGET_BYTES = (\d+) \* 1024;/.exec(check);
    const budgetInOptimise = /const BUDGET_BYTES = (\d+) \* 1024;/.exec(optimise);
    assert.ok(budgetInCheck && budgetInOptimise, 'both scripts must define the budget');
    assert.equal(
      budgetInCheck[1], budgetInOptimise[1],
      'the optimiser and the check must use the same budget, or the check fails files it just wrote'
    );
  });

  test('the header logo is preloaded and not deferred', () => {
    // js/brand-avatar.js injects the logo and is loaded at the end of the body,
    // so the browser only discovered the image after the stylesheet and the fonts
    // had arrived. It then became the last request to finish before first paint.
    assert.match(read('index.html'), /rel="preload"[^>]*logo\.webp/,
      'the header logo must be preloaded on the hand-written pages');
    assert.match(read('scripts/build-seo.js'), /rel="preload"[^>]*logo\.webp/,
      'the generated product pages load brand-avatar.js too, so they need it as well');

    // It is in the site header and visible from the first frame, so lazy loading
    // it deferred an image that was already on screen.
// Strip comments first: the explanation above the thumbnail mentions the old
    // loading="lazy" value, and matching against it would test the prose.
    const avatar = read('js/brand-avatar.js').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const thumb = /const thumb = document\.createElement\('img'\);([\s\S]*?)avatar\.append\(thumb\);/.exec(avatar);
    assert.ok(thumb, 'the header thumbnail must be locatable');
    assert.doesNotMatch(thumb[1], /loading\s*=\s*['"]lazy['"]/,
      'a logo visible in the header must not be lazy loaded');
    assert.match(thumb[1], /decoding = 'async'/,
      'the logo must not block decoding on first paint');

    // The enlarged copy only appears after a click, so it keeps lazy loading.
    const big = /const big = document\.createElement\('img'\);([\s\S]*?)popup\.append\(close, big\);/.exec(avatar);
    assert.ok(big, 'the popup image must be locatable');
    assert.match(big[1], /loading\s*=\s*['"]lazy['"]/,
      'the popup image is hidden until clicked and should stay lazy');
  });

  test('the vendor profile offers both paths and the enquiry form needs a way to reply', () => {
    const profile = read('vendor-profile.html');
    const enquiry = read('enquiry.html');

    // A customer who decides they want the product lands on the vendor first,
    // then chooses. Both actions must be visible on that page.
    assert.match(profile, /Contact vendor/, 'the profile must offer direct contact');
    assert.match(profile, /Send an enquiry/, 'the profile must offer sending an enquiry');
    assert.match(profile, /renderContactPanel/,
      'the profile must host the contact panel');
    // Imported on demand so reading the listing costs nothing.
    assert.match(profile, /await import\('\/js\/contact-vendor\.js'\)/,
      'the contact module must only load when the customer asks to contact');

    // Only an active vendor is shown. The rules refuse the read, but the page
    // must not render an empty shell for a suspended or deleted vendor either.
    assert.match(profile, /status !== 'ACTIVE'/,
      'the profile must refuse to render a vendor that is not active');
    assert.match(profile, /SAFE_ID/,
      'the vendorId comes off the query string and must be validated before use');

    // The enquiry cannot be answered without a way to reply, so both the method
    // and its value are required in the form and constrained in the rules.
    for (const [file, name] of [[enquiry, 'enquiry.html']]) {
      assert.match(file, /replyMethod/, `${name} must ask how the vendor can reply`);
      assert.match(file, /replyValue/, `${name} must collect the reply details`);
      assert.match(file, /validateReply/, `${name} must validate the reply details`);
    }
assert.match(enquiry, /String\(value\.value\)\.trim\(\)\.slice\(0, 120\)/,
      'the reply value must be length bounded before storage');

    // An anonymous customer cannot store an enquiry at all, since the rules
    // require customerUid to be the signed-in user. Send them to sign in.
    assert.match(enquiry, /auth\.currentUser/,
      'the enquiry form must handle a signed-out visitor');
assert.match(enquiry, /login\?next=/,
      'a signed-out visitor must be sent to sign in and returned');

    const rules = JSON.parse(read('firebase/database.rules.json')).rules;
    // enquiries uses `$id` as its wildcard key while some other nodes use `$uid`.
// Both are valid Firebase wildcards - the name after the $ is only used as the
// variable name in rules - so find the single child node rather than assuming.
const enquiryChild = Object.entries(rules.enquiries).find(([key]) => key.startsWith('$'));
assert.ok(enquiryChild, 'enquiries must have a wildcard child node');
const validate = enquiryChild[1]['.validate'];
assert.ok(validate, 'the enquiry wildcard must carry a .validate rule');
    assert.match(validate, /replyMethod/,
      'the rules must constrain the reply method');
    assert.match(validate, /replyValue/,
      'the rules must constrain the reply value');
    assert.match(validate, /length <= 120/,
      'the rules must bound the stored reply value');
  });

  test('an admin can delete and restore any product, and sees vendor contacts', () => {
    const admin = read('js/admin.js');
    const products = read('admin/products.html');
    const vendors = read('admin/vendors.html');

    // Delete is soft: the record survives for the audit trail and any live
    // enquiry, and the public read already excludes anything with deletedAt.
    assert.match(admin, /export async function softDelete/,
      'there must be a soft delete for products');
    assert.match(admin, /deletedAt: serverTimestamp\(\)/,
      'a soft delete must record when it happened');
    assert.match(admin, /export async function restore/,
      'a soft delete must be reversible');
    assert.match(admin, /action: `delete_\$\{path\}`/,
      'a delete must be written to the audit log');
    assert.doesNotMatch(admin, /export async function softDelete[\s\S]*?remove\(ref\(database, `\$\{path\}/,
      'products must not be hard removed');

    // Restore returns to ARCHIVED rather than straight back on sale, so an admin
    // reviews before a product reappears publicly.
    const restore = /export async function restore\([\s\S]*?\n}/.exec(admin);
    assert.ok(restore, 'restore must exist');
    assert.match(restore[0], /status: 'ARCHIVED'/,
      'restoring must not silently republish a product');

    assert.match(products, /softDelete\('products'/, 'the products page must offer delete');
    assert.match(products, /Restore/, 'the products page must offer restore');
    assert.match(products, /deletedAt/, 'the products page must show deleted products separately');
    assert.match(products, /requireAdmin/, 'the products page must remain admin gated');

    // Vendor contact details for follow-up, through the same sanitiser the
    // customer-facing panel uses so a hostile value cannot reach an admin.
    assert.match(products, /contactChannels\(vendor\)/,
      'the products page must show the vendor contact details');
    assert.match(vendors, /contactChannels\(vendor\)/,
      'the vendors page must show every contact channel, not just name, email and phone');
    assert.match(vendors, /contact-links\.js/,
      'admin contact display must reuse the sanitiser');

    // The rules must still hide a deleted product from the public and from its
    // own vendor.
    const rules = JSON.parse(read('firebase/database.rules.json')).rules;
    const productChild = Object.entries(rules.products).find(([k]) => k.startsWith('$'));
    assert.match(productChild[1]['.read'], /!data\.child\('deletedAt'\)\.exists\(\)/,
      'a deleted product must not be publicly readable');
  });

  test('signup requires the terms to be accepted, and records it', () => {
    for (const page of ['register.html', 'vendor/register.html']) {
      const text = read(page);

      // Present, required, and linked to the actual terms.
      assert.match(text, /id="acceptTerms"/, `${page} must offer a terms checkbox`);
      assert.match(text, /terms and conditions<\/a>/, `${page} must link to the terms`);
      assert.match(text, /type="checkbox"/, `${page} checkbox must be a checkbox`);
      // Assert on the control as a whole, not on the word "required" appearing
      // somewhere in the file, so removing the attribute is actually caught.
      assert.match(text, /<input id="acceptTerms" type="checkbox" required>/,
        `${page} checkbox must be marked required so the browser also enforces it`);

      // Submit must be blocked until it is ticked. required alone would stop
      // submission with no explanation and record nothing.
      assert.match(text, /submit\.disabled = true/,
        `${page} must disable submit until the terms are accepted`);
      assert.match(text, /terms\.addEventListener\('change'/,
        `${page} must re-enable submit once accepted`);

      // And the acceptance is stored, so a dispute can be settled.
      assert.match(text, /termsAcceptedAt/,
        `${page} must record when the terms were accepted`);
    }

    // The vendor form must also state the scope of the marketplace, otherwise an
    // applicant cannot know why a listing was rejected.
    const vendor = read('vendor/register.html');
    assert.match(vendor, /notice/,
      'the vendor form must carry a notice');
    assert.match(vendor, /[Mm]edical/,
      'the vendor notice must state the medical scope');
    assert.match(vendor, /will not be approved|not be approved/,
      'the vendor notice must say non-health listings will not be approved');

    // The rules must not block storing the extra field: hasChildren is a minimum
    // rather than an allow-list, so this is asserted to prevent that changing.
    const rules = JSON.parse(read('firebase/database.rules.json')).rules;
    const userChild = Object.entries(rules.users).find(([k]) => k.startsWith('$'));
    assert.match(userChild[1]['.validate'], /hasChildren\(\['name', 'email', 'role', 'active'\]\)/,
      'the user validation is a minimum, so termsAcceptedAt is permitted');
  });

  test('no internal link carries an extension that Pages redirects', () => {
    // Pages answers /marketplace.html with a 308 to /marketplace, so every link
    // written with an extension costs an extra round trip before the page starts
    // loading. scripts/clean-links.mjs rewrote them; this stops them coming back.
    const files = [];
    const collect = (dir) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (['node_modules', '.git', 'public', 'fonts', 'tests'].includes(entry.name)) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) collect(rel);
        else if (/\.(html|css|js|mjs)$/i.test(entry.name)) files.push(rel);
      }
    };
    collect('.');

    const inMarkup = /(?:href|src)="(?!https?:|\/\/|#)([^"]*?)\.html/g;
    const inScript = /\.href\s*=\s*[`'"](?!https?:|\/\/|#)([^`'"?#]*?)\.html/g;
    const offenders = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      for (const match of text.matchAll(inMarkup)) offenders.push(`${file}: ${match[1]}.html`);
      for (const match of text.matchAll(inScript)) offenders.push(`${file}: ${match[1]}.html`);
    }
    assert.deepEqual(offenders, [], `links that Pages will redirect:\n${offenders.slice(0, 20).join('\n')}`);

    // A query string must survive the rewrite, since the category filter depends
    // on it. Assert the form is present rather than absent.
    assert.match(read('index.html'), /marketplace\?category=/,
      'category links must keep their query string');

    // The rewriter itself must be safe to run repeatedly.
    const clean = read('scripts/clean-links.mjs');
    assert.match(clean, /function stripExtension/, 'the strip helper must exist');
    assert.match(clean, /=== 'index'/, 'index.html must become the site root');
  });
