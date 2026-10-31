import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Classic script: run it the way a <script> tag would, with a tiny fake localStorage
// and a controllable clock, and take the class it publishes on window.
function load(now) {
  const store = new Map();
  const scope = {
    window: {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k)
    },
    Date: { now: () => now.value }
  };
  scope.window = scope;
  vm.runInNewContext(fs.readFileSync('js/login-lockout.js', 'utf8'), scope);
  return scope.VHMARTLockout.create;
}

test('allows attempts until the threshold, then locks out with a growing wait', () => {
  const now = { value: 1000000 };
  const create = load(now);
  const lock = create('person@example.com', { maxAttempts: 3, baseMs: 10000, maxMs: 60000 });

  assert.equal(lock.secondsLeft(), 0);
  lock.recordFailure();
  lock.recordFailure();
  assert.equal(lock.secondsLeft(), 0, 'must not lock out before the threshold');

  const wait = lock.recordFailure();
  assert.equal(wait, 10, 'the third failure crosses the threshold and starts a 10s lockout');
  assert.equal(lock.secondsLeft(), 10);

  const wait2 = lock.recordFailure();
  assert.equal(wait2, 20, 'each further failure doubles the wait');
});

test('a success clears the counter and any lockout', () => {
  const now = { value: 2000000 };
  const create = load(now);
  const lock = create('person@example.com', { maxAttempts: 2, baseMs: 5000 });
  lock.recordFailure();
  lock.recordFailure();
  assert.ok(lock.secondsLeft() > 0);
  lock.recordSuccess();
  assert.equal(lock.secondsLeft(), 0);
});

test('the wait never exceeds the configured maximum', () => {
  const now = { value: 3000000 };
  const create = load(now);
  const lock = create('person@example.com', { maxAttempts: 1, baseMs: 10000, maxMs: 15000 });
  lock.recordFailure();
  const wait = lock.recordFailure();
  assert.ok(wait <= 15, 'must be capped at maxMs');
});

test('two different accounts on the same browser are tracked separately', () => {
  const now = { value: 4000000 };
  const create = load(now);
  const a = create('a@example.com', { maxAttempts: 1, baseMs: 10000 });
  const b = create('b@example.com', { maxAttempts: 1, baseMs: 10000 });
  a.recordFailure();
  assert.ok(a.secondsLeft() > 0);
  assert.equal(b.secondsLeft(), 0, 'account b must not be locked out by account a\'s failures');
});

test('login.html and admin/login.html load the lockout script and use it on submit', () => {
  const login = fs.readFileSync('login.html', 'utf8');
  assert.match(login, /<script src="js\/login-lockout\.js"><\/script>/);
  assert.match(login, /VHMARTLockout\??\.create/);
  assert.match(login, /recordFailure|recordSuccess/);

  const adminLogin = fs.readFileSync('admin/login.html', 'utf8');
  assert.match(adminLogin, /<script src="\.\.\/js\/login-lockout\.js"><\/script>/);
  assert.match(adminLogin, /VHMARTLockout\??\.create/);
});
