#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(); const files = []; function walk(folder) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { if (['node_modules', '.git'].includes(entry.name)) continue; const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else files.push(full); } } walk(root);
const html = files.filter((file) => file.endsWith('.html')); const missing = []; const links = /(?:href|src)=["']([^"']+)["']/gi;
for (const file of html) { const source = fs.readFileSync(file, 'utf8'); for (const match of source.matchAll(links)) { const target = match[1].split(/[?#]/)[0]; if (!target || /^(https?:|mailto:|javascript:|data:|#)/i.test(target)) continue; const resolved = path.resolve(path.dirname(file), target); if (!fs.existsSync(resolved)) missing.push(`${path.relative(root, file)} -> ${target}`); } }
if (missing.length) { console.error(`Missing internal references:\n${missing.join('\n')}`); process.exit(1); } console.log(`Static references valid: ${html.length} HTML files checked.`);
