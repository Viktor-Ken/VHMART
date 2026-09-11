import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('vendor registration creates an active vendor immediately', () => {
  const source = read('vendor/register.html');
  assert.match(source, /role:'vendor'/);
  assert.match(source, /status:'ACTIVE'/);
  assert.match(source, /updates\[`users\//);
  assert.match(source, /updates\[`vendors\//);
  assert.doesNotMatch(source, /vendor_applications/);
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
    if (!/\.(html|js|json|css|md)$/.test(file) || file.endsWith('tests/release.test.js')) continue;
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
