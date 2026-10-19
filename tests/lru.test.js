import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The file is a classic script (the service worker loads it with importScripts), so run it
// the way a worker would and take the class it publishes.
const scope = {};
scope.self = scope;
vm.runInNewContext(fs.readFileSync('js/lru-cache.js', 'utf8'), scope);
const LRUCache = scope.LRUCache;

test('drops the least recently used entry when full', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.has('a'), false);
  assert.deepEqual([...cache.keys()], ['b', 'c']);
});

test('reading an entry protects it from eviction', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.deepEqual([...cache.keys()], ['a', 'c']);
});

test('peek does not count as a use, and setting again refreshes the entry', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.peek('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.has('a'), false);
  cache.set('b', 20);
  cache.set('d', 4);
  assert.deepEqual([...cache.keys()], ['b', 'd']);
  assert.equal(cache.get('b'), 20);
});

test('reports evictions and rejects a limit below 1', () => {
  const gone = [];
  const cache = new LRUCache(1, (key, value) => gone.push([key, value]));
  cache.set('a', 1);
  assert.deepEqual([...cache.set('b', 2)], ['a']);
  assert.deepEqual(gone, [['a', 1]]);
  assert.equal(cache.size, 1);
  assert.throws(() => new LRUCache(0), { name: 'RangeError' });
});

test('the service worker caps its stored files with the LRU cache', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(sw, /importScripts\('\/js\/lru-cache\.js'\)/);
  assert.match(sw, /new LRUCache\(MAX_ENTRIES/);
  assert.match(sw, /cache\.delete\(url\)/);
});
