import test from 'node:test';
import assert from 'node:assert/strict';
import { joinCatalogue } from '../scripts/catalogue-join.js';

const products = [
  { id: 'p1', name: 'Scrubs', vendorId: 'v1', categoryId: 'hospital-wears' },
  { id: 'p2', name: 'Book', vendorId: 'v2', categoryId: 'books' },
  { id: 'p3', name: 'Mystery', vendorId: 'v3', categoryId: 'not-a-category' },
  { id: 'p4', name: 'Old listing' },
  { id: 'p5', name: 'Gym mat', vendorId: 'v4', categoryId: 'fitness' }
];
const vendors = new Map([
  ['v1', { status: 'ACTIVE', businessName: 'Care Wear' }],
  ['v2', { status: 'SUSPENDED', businessName: 'Paper Co' }],
  ['v4', { status: 'INACTIVE' }]
]);

test('adds the vendor business name and the readable category name', () => {
  const [first] = joinCatalogue(products, vendors);
  assert.equal(first.id, 'p1');
  assert.equal(first.vendorName, 'Care Wear');
  assert.equal(first.categoryName, 'Hospital wears');
});

test('leaves out products whose vendor is known not to be active', () => {
  const ids = joinCatalogue(products, vendors).map((product) => product.id);
  assert.deepEqual([...ids], ['p1', 'p3', 'p4']);
});

test('keeps products whose vendor or category is unknown, in the original order', () => {
  const result = joinCatalogue(products, vendors);
  const mystery = result.find((product) => product.id === 'p3');
  assert.equal(mystery.vendorName, undefined);
  assert.equal(mystery.categoryName, undefined);
  assert.equal(result.find((product) => product.id === 'p4').name, 'Old listing');
});

test('works with no vendor information at all', () => {
  assert.equal(joinCatalogue(products).length, products.length);
});
