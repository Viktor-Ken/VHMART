import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDir, 'products.json');
const databaseURL = 'https://visuamall-a620f-default-rtdb.firebaseio.com';

async function fetchPublishedProducts() {
  const url = new URL(`${databaseURL}/products.json`);
  url.searchParams.set('orderBy', '"status"');
  url.searchParams.set('equalTo', '"PUBLISHED"');
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) {
    throw new Error(`Database returned HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .map(([id, product]) => ({ id, ...product }))
    .filter((product) => product && product.status === 'PUBLISHED' && product.availability !== 'UNAVAILABLE');
}

try {
  const products = await fetchPublishedProducts();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    count: products.length,
    products
  };
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Snapshot written: ${outputPath}`);
  console.log(`Published products: ${products.length}`);
} catch (error) {
  console.error('Could not generate snapshot:', error.message);
  process.exit(1);
}