#!/usr/bin/env node
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: node scripts/validate-migration.js migrated.json'); process.exit(1); }
const document = JSON.parse(fs.readFileSync(file, 'utf8')); const data = document.data || document;
const failures = [];
for (const [id, vendor] of Object.entries(data.vendors || {})) { if (!vendor.businessName || !vendor.status || !vendor.categoryId) failures.push(`vendor ${id}`); }
for (const [id, product] of Object.entries(data.products || {})) { if (!product.vendorId || !product.name || !product.status) failures.push(`product ${id}`); }
if (failures.length) { console.error(`Invalid records: ${failures.join(', ')}`); process.exit(1); }
console.log(`Migration valid: ${Object.keys(data.vendors || {}).length} vendors, ${Object.keys(data.products || {}).length} products.`);
