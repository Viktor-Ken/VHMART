// Rewrite internal .html links to the extensionless form Cloudflare serves
// directly.
//
// Pages redirects /marketplace.html to /marketplace with a 308, so every
// internal link written as foo.html costs an extra round trip before the page
// starts loading. The extensionless form returns 200 with no redirect.
//
// Rules:
//   index.html        -> /            (the site root, not an empty path)
//   foo.html?x=1      -> /foo?x=1     (the query string must survive)
//   ../admin/foo.html -> ../admin/foo (relative depth is preserved)
//   external, absolute, anchor, mailto and data URLs are left alone
//
// Run: node scripts/clean-links.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'public', 'fonts']);

const files = [];
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
    else if (/\.(html|css|js|mjs)$/i.test(entry.name)) files.push(rel);
  }
}
await walk(root);

// href="..." or src="..." or url(...) in CSS. The value must not start a URL
// scheme, a protocol-relative URL, an anchor, or a data URI.
//
// Capture groups: 1 the attribute and its opening quote, 2 the path up to
// .html, 3 whatever followed .html - a query string or fragment. The path class
// excludes ? and # so group 3 keeps them intact.
const ATTRIBUTE = /((?:href|src)=")(?!https?:|mailto:|tel:|data:|\/\/|#)([^"?#]*?)\.html((?:\?[^"#]*)?(?:#[^"]*)?)"/g;
// CSS url(...) references. Kept deliberately simple: the only thing that needs
// rewriting in the stylesheet is a path to an .html file, and there is no case
// where dropping the extension would be wrong.
const CSS_URL = /(\burl\(\s*['"]?)(?!https?:|data:|\/\/)([^'")]*?)\.html(['"]?\s*\))/g;

// Runtime navigation assigned in JavaScript. location.href = 'account' and
// .href = 'foo' both cost the same 308 as a markup link, so they are
// rewritten too. Matches a quoted string on the right of an assignment.
const JS_HREF = /(\.(?:href|assign)\s*=\s*[`'"])(?!https?:|\/\/|mailto:|tel:|#)([^`'"?#]*?)\.html((?:\?[^`'"]*)?)([`'"])/g;

// index.html becomes the site root; everything else loses just the extension.
function stripExtension(pathPart) {
  return pathPart === 'index' || pathPart.endsWith('/index') ? '' : pathPart;
}

let total = 0;
const touched = [];

for (const file of files) {
  const full = path.join(root, file);
  const before = await readFile(full, 'utf8');

  const after = before
    .replace(ATTRIBUTE, (match, open, pathPart, tail) => `${open}${stripExtension(pathPart)}${tail}"`)
    .replace(CSS_URL, (match, open, pathPart, close) => `${open}${stripExtension(pathPart)}${close}`)
    .replace(JS_HREF, (match, open, pathPart, tail, close) => `${open}${stripExtension(pathPart)}${tail}${close}`);

  if (after !== before) {
    const count = (before.match(ATTRIBUTE) || []).length + (before.match(CSS_URL) || []).length;
    await writeFile(full, after, 'utf8');
    touched.push({ file, count });
    total += count;
  }
}

for (const { file, count } of touched) {
  console.log(`  ${file.padEnd(32)} ${count}`);
}
console.log(`\n${total} link(s) rewritten to the extensionless form`);