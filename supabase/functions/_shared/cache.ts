/**
 * Edge-level in-memory cache for read-heavy endpoints.
 *
 * Since Deno edge functions have short-lived isolates, this cache
 * is effective within a single isolate's lifespan (typically seconds
 * to minutes under sustained traffic). Under high concurrency,
 * this prevents redundant DB queries within the same isolate.
 *
 * For cross-isolate caching, responses include Cache-Control headers
 * that CDN/proxy layers can respect.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// Prevent unbounded memory growth
const MAX_ENTRIES = 500;

/**
 * Get a cached value, or compute it via the factory function.
 * TTL is in seconds.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;

  if (existing && existing.expiresAt > now) {
    return existing.data;
  }

  const data = await factory();

  // Evict oldest entries if at capacity
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }

  store.set(key, { data, expiresAt: now + ttlSeconds * 1000 });
  return data;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all keys matching a prefix.
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Returns standard Cache-Control headers for different data freshness needs.
 */
export function cacheHeaders(
  strategy: "static" | "short" | "private-short" | "no-cache"
): Record<string, string> {
  switch (strategy) {
    case "static":
      // Immutable data (evidence packs, sealed records)
      return { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
    case "short":
      // Frequently read, infrequently changed (health, org profiles)
      return { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" };
    case "private-short":
      // User-specific data (balances, matches list)
      return { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" };
    case "no-cache":
      // Mutations, real-time data
      return { "Cache-Control": "no-store, no-cache, must-revalidate" };
  }
}
