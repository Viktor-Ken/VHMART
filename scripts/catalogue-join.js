// Joins products to their vendor and category with SQL.
//
// The live data sits in Firebase Realtime Database, which has no joins: a product only
// carries a vendorId and a categoryId. The build loads the three lists into a throw-away
// in-memory SQLite database and lets one LEFT JOIN query put them together, instead of
// hand-written lookups. The result is what the product pages and products.json show:
// the vendor's business name, the category's readable name, and no products whose
// vendor is known not to be active.
//
// Uses node:sqlite, built into Node 22.13 and later (nothing to install).
import { DatabaseSync } from 'node:sqlite';

// Same ids and names as `categories` in js/marketplace.js.
export const CATEGORIES = [
  ['general', 'General'],
  ['books', 'Books'],
  ['courses', 'Courses'],
  ['hospital-wears', 'Hospital wears'],
  ['wellness', 'Wellness'],
  ['hospital-lab-equipment', 'Hospital & lab equipment'],
  ['health-travel', 'Health travel'],
  ['fitness', 'Fitness'],
  ['men-shoes', 'Men shoes'],
  ['women-shoes', 'Women shoes']
];

// products: [{ id, vendorId, categoryId, ... }]
// vendors:  Map of vendorId -> { status, businessName }. A vendor missing from the map is
//           "unknown" (for example the lookup failed) and its products are kept.
// Returns the products in their original order, each with vendorName and categoryName
// when known. Products whose vendor is not ACTIVE are left out.
export function joinCatalogue(products, vendors = new Map()) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE vendors    (id TEXT PRIMARY KEY, business_name TEXT, status TEXT NOT NULL);
      CREATE TABLE products   (id TEXT PRIMARY KEY, position INTEGER NOT NULL, vendor_id TEXT, category_id TEXT, json TEXT NOT NULL);
    `);

    const addCategory = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)');
    for (const [id, name] of CATEGORIES) addCategory.run(id, name);

    const addVendor = db.prepare('INSERT INTO vendors (id, business_name, status) VALUES (?, ?, ?)');
    for (const [id, vendor] of vendors) {
      addVendor.run(id, vendor.businessName ? String(vendor.businessName) : null, String(vendor.status || 'UNKNOWN'));
    }

    const addProduct = db.prepare('INSERT INTO products (id, position, vendor_id, category_id, json) VALUES (?, ?, ?, ?, ?)');
    products.forEach((product, position) => {
      addProduct.run(product.id, position, product.vendorId || null, product.categoryId || null, JSON.stringify(product));
    });

    const rows = db.prepare(`
      SELECT p.json AS json, v.business_name AS vendorName, c.name AS categoryName
      FROM products p
      LEFT JOIN vendors    v ON v.id = p.vendor_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE v.id IS NULL OR v.status = 'ACTIVE'
      ORDER BY p.position
    `).all();

    return rows.map((row) => ({
      ...JSON.parse(row.json),
      ...(row.vendorName ? { vendorName: row.vendorName } : {}),
      ...(row.categoryName ? { categoryName: row.categoryName } : {})
    }));
  } finally {
    db.close();
  }
}
