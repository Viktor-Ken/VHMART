// Least-recently-used cache: holds at most `limit` entries and, when a new one
// would not fit, drops the entry that was used longest ago.
//
// A Map remembers insertion order, so "used" is expressed by deleting a key and
// putting it back at the end. The oldest key is always the first one.
//
// It is a classic script that also works as a module so the service worker
// (importScripts), pages (<script>) and the tests can all use the same code.
(function (root, factory) {
  var LRUCache = factory();
  if (typeof module === 'object' && module.exports) module.exports = LRUCache;
  root.LRUCache = LRUCache;
})(typeof self !== 'undefined' ? self : this, function () {
  function LRUCache(limit, onEvict) {
    if (!(limit >= 1)) throw new RangeError('LRUCache needs a limit of at least 1');
    this.limit = Math.floor(limit);
    this.onEvict = typeof onEvict === 'function' ? onEvict : null;
    this.map = new Map();
  }

  Object.defineProperty(LRUCache.prototype, 'size', { get: function () { return this.map.size; } });

  // Returns the value and marks it as just used; undefined when absent.
  LRUCache.prototype.get = function (key) {
    if (!this.map.has(key)) return undefined;
    var value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  };

  // Looks without counting as a use.
  LRUCache.prototype.peek = function (key) { return this.map.get(key); };
  LRUCache.prototype.has = function (key) { return this.map.has(key); };

  // Adds or replaces an entry as the most recently used. Returns the evicted keys.
  LRUCache.prototype.set = function (key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    var evicted = [];
    while (this.map.size > this.limit) {
      var oldest = this.map.keys().next().value;
      var oldValue = this.map.get(oldest);
      this.map.delete(oldest);
      evicted.push(oldest);
      if (this.onEvict) this.onEvict(oldest, oldValue);
    }
    return evicted;
  };

  LRUCache.prototype.delete = function (key) { return this.map.delete(key); };
  LRUCache.prototype.clear = function () { this.map.clear(); };

  // Keys from least to most recently used (handy for saving and restoring order).
  LRUCache.prototype.keys = function () { return Array.from(this.map.keys()); };

  return LRUCache;
});
