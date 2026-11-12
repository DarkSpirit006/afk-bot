/**
 * Sliding-window rate limiter keyed by player name (or any string).
 * Used to keep a public bot from being spammed into a server mute.
 */
function createRateLimit({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  const maxLimit = Math.max(1, limit);
  const maxWindow = Math.max(1, windowMs);

  const prune = (timestamp) => {
    for (const [key, stamps] of hits)
      if (!stamps.length || timestamp - stamps[stamps.length - 1] > maxWindow)
        hits.delete(key);
  };

  return {
    limit: maxLimit,
    windowMs: maxWindow,
    allow(key) {
      const timestamp = now();
      const stamps = (hits.get(key) || []).filter(
        (stamp) => timestamp - stamp < maxWindow,
      );
      if (stamps.length >= maxLimit) {
        hits.set(key, stamps);
        return false;
      }
      stamps.push(timestamp);
      hits.set(key, stamps);
      if (hits.size > 1000) prune(timestamp);
      return true;
    },
    reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },
    size: () => hits.size,
  };
}

module.exports = { createRateLimit };
