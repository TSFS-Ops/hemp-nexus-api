/**
 * Batch N — canonical API key scope catalogue.
 *
 * Every scope an API key may carry MUST appear here. Unknown scopes are
 * rejected at create time by apiKeyCreateSchema, and requireScope() will
 * only accept exact matches or explicit `${parent}:*` wildcard grants.
 *
 * Hierarchy rules (Batch N — Required Fix 2):
 *  - A key with scope `match` does NOT satisfy `match:write`.
 *  - A key with scope `match:write` does NOT satisfy `match` and does
 *    NOT satisfy `match:read`.
 *  - A key with scope `match:*` DOES satisfy `match`, `match:read`,
 *    `match:write` — wildcards are explicit and must be declared.
 *
 * Banned scopes: `*`, `admin`, empty strings.
 */

export const VALID_SCOPES = [
  // Coarse-grained endpoint scopes (kept for back-compat with existing
  // requireScope(authCtx, 'match') style callsites).
  "match",
  "match:read",
  "match:write",
  "match:*",
  "signals",
  "signals:read",
  "signals:write",
  "signals:*",
  "collapse",
  "preflight",
  "trade-status",
  "evidence",
  "evidence:read",
  "evidence:*",
  "search",
  "screening",
  "consents",
  "consents:read",
  "consents:write",
  "consents:*",
  "data_sources",
  "data_sources:read",
  "data_sources:write",
  "data_sources:*",
  "orgs",
  "orgs:read",
  "orgs:write",
  "orgs:*",
  "audit_logs",
  "api_keys",
  "api_keys:read",
  "api_keys:write",
  "api_keys:*",
  "webhooks",
  "webhooks:read",
  "webhooks:write",
  "webhooks:*",
  "pois",
  "pois:read",
  "pois:write",
  "pois:transition",
  "pois:*",
  "admin:reputation",
  "admin:tests",
  "admin:engagements",
  "wad",
] as const;

export type ApiScope = typeof VALID_SCOPES[number];

const VALID_SCOPE_SET: ReadonlySet<string> = new Set(VALID_SCOPES);

/** Forbidden scope values — must NEVER be accepted at create time. */
export const FORBIDDEN_SCOPES: ReadonlySet<string> = new Set([
  "*",
  "admin",
  "",
]);

/**
 * Validate a single scope string. Returns true only if it appears in
 * VALID_SCOPES and is not banned.
 */
export function isValidScope(scope: unknown): scope is ApiScope {
  if (typeof scope !== "string") return false;
  if (FORBIDDEN_SCOPES.has(scope)) return false;
  return VALID_SCOPE_SET.has(scope);
}

/**
 * Validate and normalise an array of scopes — rejects unknown/forbidden,
 * de-duplicates, and preserves declaration order. Throws Error with a
 * human-readable message on failure (caller wraps as ApiException).
 */
export function validateAndNormaliseScopes(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error("scopes must be an array of strings");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      throw new Error("scopes must be strings");
    }
    const s = raw.trim();
    if (FORBIDDEN_SCOPES.has(s)) {
      throw new Error(`scope "${s || "<empty>"}" is forbidden`);
    }
    if (!VALID_SCOPE_SET.has(s)) {
      throw new Error(`unknown scope "${s}"`);
    }
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Batch N — exact-match scope check. The legacy `r.startsWith(scope + ':')`
 * behaviour is REMOVED: a key with `pois:read` no longer satisfies a
 * required scope of `pois` (and vice versa). Wildcards must be explicit:
 * `pois:*` satisfies any `pois:<verb>` required scope.
 */
export function scopeSatisfies(
  heldScopes: readonly string[],
  required: string,
): boolean {
  for (const held of heldScopes) {
    if (held === required) return true;
    // Explicit wildcard grant — held === "pois:*" satisfies "pois:read"
    // and the bare "pois" required scope.
    if (held.endsWith(":*")) {
      const parent = held.slice(0, -2);
      if (required === parent) return true;
      if (required.startsWith(parent + ":")) return true;
    }
  }
  return false;
}
