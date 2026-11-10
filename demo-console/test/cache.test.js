const { test } = require('node:test');
const assert = require('node:assert');
const { createCache } = require('../lib/cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('concurrent callers share one in-flight call', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => { calls++; await sleep(50); return calls; };

  const results = await Promise.all(Array.from({ length: 50 }, () => cache.get('k', 1000, fn)));

  assert.strictEqual(calls, 1, '50 simultaneous polls must cost one call');
  assert.ok(results.every((r) => r === 1));
});

test('a fresh result is served from cache until the ttl expires', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => ++calls;

  await cache.get('k', 100, fn);
  await cache.get('k', 100, fn);
  assert.strictEqual(calls, 1);

  await sleep(120);
  await cache.get('k', 100, fn);
  assert.strictEqual(calls, 2);
});

test('different keys are cached independently', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => ++calls;

  await cache.get('a', 1000, fn);
  await cache.get('b', 1000, fn);
  assert.strictEqual(calls, 2);
});

test('clear() forces the next call to refresh', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => ++calls;

  await cache.get('k', 10000, fn);
  cache.clear();
  await cache.get('k', 10000, fn);
  assert.strictEqual(calls, 2);
});

test('a rejected call is not cached', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };

  await assert.rejects(cache.get('k', 10000, fn), /boom/);
  assert.strictEqual(await cache.get('k', 10000, fn), 'ok');
  assert.strictEqual(calls, 2);
});

test('clear() during an in-flight call does not let the stale result land in the cache', async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => { const n = ++calls; await sleep(50); return n; };

  const first = cache.get('k', 10000, fn); // starts call 1
  await sleep(10);
  cache.clear();                            // e.g. a POST changed cluster state mid-poll
  assert.strictEqual(await first, 1);       // the original caller still gets its answer

  assert.strictEqual(await cache.get('k', 10000, fn), 2, 'next poll must not be served the pre-clear result');
});
