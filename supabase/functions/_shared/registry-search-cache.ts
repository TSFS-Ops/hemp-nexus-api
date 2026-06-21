/**
 * Batch 8 follow-up — short-lived in-process response cache for
 * registry-company-search. Keys include the rate-limit scope so cached
 * responses never cross between IP/API-key/admin callers, and include
 * the full normalised request payload so visibility tiers and filters
 * are honoured. TTL is intentionally short (30 seconds) to bound
 * staleness; rate-limit charging still happens on every request.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 500;

interface Entry {
  expiresAt: number;
  body: string;
}

const store = new Map<string, Entry>();

export interface CacheKeyInput {
  scopeKind: string;
  scopeKey: string;
  endpoint: string;
  payload: unknown;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const stable = stableStringify(input.payload ?? {});
  return `${input.endpoint}|${input.scopeKind}|${input.scopeKey}|${stable}`;
}

export function getCached(key: string): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.body;
}

export function setCached(key: string, body: string): void {
  if (store.size > MAX_ENTRIES) {
    // Cheap eviction — drop the oldest 10% of entries.
    const drop = Math.ceil(MAX_ENTRIES * 0.1);
    let i = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++i >= drop) break;
    }
  }
  store.set(key, { expiresAt: Date.now() + TTL_MS, body });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
}
