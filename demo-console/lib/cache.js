// Single-flight TTL cache for the endpoints the browser polls.
//
// Every open tab polls status every few seconds, and each poll shells out to
// `oc`. Without this, load scales with the number of tabs and grows without
// bound once a single `oc` call is slower than the polling interval. With it,
// each key costs at most one in-flight call no matter how many tabs are open,
// and nothing at all when nobody is looking.
function createCache() {
  const entries = new Map(); // key -> { value, expires } | { promise }
  let generation = 0;

  function get(key, ttlMs, fn) {
    const hit = entries.get(key);
    if (hit) {
      if (hit.promise) return hit.promise;
      if (hit.expires > Date.now()) return Promise.resolve(hit.value);
    }

    const gen = generation;
    const promise = Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          // If clear() ran while we were in flight, the cluster may have changed
          // under us; hand the result to the callers who asked, but don't keep it.
          if (gen === generation) entries.set(key, { value, expires: Date.now() + ttlMs });
          return value;
        },
        (err) => {
          if (gen === generation) entries.delete(key);
          throw err;
        },
      );
    entries.set(key, { promise });
    return promise;
  }

  function clear() {
    generation++;
    entries.clear();
  }

  return { get, clear };
}

module.exports = { createCache };
