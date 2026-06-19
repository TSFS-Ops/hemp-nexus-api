/**
 * Public API V1 · Sandbox / Production Separation · Batch 4
 *
 * Canonical V1 scope catalogue + canonical route classification.
 *
 * Single source of truth for:
 *   - which scopes are valid on a V1 key;
 *   - per-scope environment availability (sandbox / production / both);
 *   - per-route environment classification (sandbox_only / production_only
 *     / both);
 *   - the explicit set of forbidden scopes that must never appear on a
 *     V1 key, even by accident.
 *
 * NOTE: The `api_keys_assert_scopes_allowed` DB trigger (Batch 2) is the
 * authoritative server-side enforcer of forbidden scopes. This module
 * mirrors that contract for in-gateway pre-checks and tests. Keeping the
 * two in sync is asserted by the Batch 4 test pack.
 */

export type V1Environment = "sandbox" | "production";
export type V1ScopeEnvRule = "sandbox" | "production" | "both";
export type V1RouteClassification = "sandbox_only" | "production_only" | "both";

export interface V1ScopeDefinition {
  scope: string;
  envRule: V1ScopeEnvRule;
  /** Production use requires that the linked api_client has a passing
   *  api_production_approvals record (enforced at key issuance + at
   *  request time by runGateway). */
  productionRequiresApproval: boolean;
  /** Whether the response carries client-private data only. */
  clientOwnDataOnly: boolean;
  notes: string;
}

/**
 * Canonical V1 scope catalogue (Batch 4).
 *
 * `profile:summary_read` is intentionally retained as a back-compat alias
 * for `counterparty:summary_read` so existing Batch-5 keys keep working;
 * both map to the same surface and follow the same environment rules.
 */
export const V1_SCOPE_CATALOGUE: ReadonlyArray<V1ScopeDefinition> = [
  {
    scope: "api:status_read",
    envRule: "both",
    productionRequiresApproval: false,
    clientOwnDataOnly: true,
    notes: "Health + status. Non-billable.",
  },
  {
    scope: "counterparty:lookup",
    envRule: "both",
    productionRequiresApproval: true,
    clientOwnDataOnly: false,
    notes: "Production conservative until approved production source wired.",
  },
  {
    scope: "counterparty:summary_read",
    envRule: "both",
    productionRequiresApproval: true,
    clientOwnDataOnly: false,
    notes: "Production responses restricted to approved shareable fields.",
  },
  {
    scope: "profile:summary_read",
    envRule: "both",
    productionRequiresApproval: true,
    clientOwnDataOnly: false,
    notes: "Legacy alias of counterparty:summary_read.",
  },
  {
    scope: "usage:read",
    envRule: "both",
    productionRequiresApproval: false,
    clientOwnDataOnly: true,
    notes: "Client-own usage only.",
  },
  {
    scope: "webhook:test",
    envRule: "sandbox",
    productionRequiresApproval: false,
    clientOwnDataOnly: true,
    notes: "Deterministic sandbox-only webhook ping helpers.",
  },
  {
    scope: "webhook:events_read",
    envRule: "production",
    productionRequiresApproval: true,
    clientOwnDataOnly: true,
    notes: "Production-only; only meaningful where webhooks enabled. Dispatcher itself is NOT built in Batch 4.",
  },
  // Back-compat: signals:read is a signal-bearing supplemental scope
  // already used by Batch-5 lookup/summary endpoints. It is preserved
  // explicitly so existing keys do not break.
  {
    scope: "signals:read",
    envRule: "both",
    productionRequiresApproval: true,
    clientOwnDataOnly: false,
    notes: "Compatibility scope — required on signal-bearing responses.",
  },
];

const SCOPE_BY_NAME = new Map(V1_SCOPE_CATALOGUE.map((s) => [s.scope, s]));

export function lookupV1Scope(scope: string): V1ScopeDefinition | null {
  return SCOPE_BY_NAME.get(scope) ?? null;
}

/**
 * Forbidden scopes — never appear on a V1 key. Mirrors the
 * api_keys_assert_scopes_allowed DB trigger. Keeping these in sync is
 * asserted by the Batch 4 test pack.
 */
export const V1_FORBIDDEN_SCOPES: ReadonlyArray<string> = [
  "evidence_export",
  "governance_record_write",
  "verification_override",
  "payment_approve",
  "compliance_clearance",
  "poi:create",
  "wad:issue",
  "document_upload",
  "bank_detail_change",
  "client_data_export",
];

/** Wildcard families that are also forbidden (write:*, admin:*). */
export const V1_FORBIDDEN_SCOPE_PREFIXES: ReadonlyArray<string> = [
  "write:",
  "admin:",
];

export function isForbiddenV1Scope(scope: string): boolean {
  if (V1_FORBIDDEN_SCOPES.includes(scope)) return true;
  for (const p of V1_FORBIDDEN_SCOPE_PREFIXES) {
    if (scope.startsWith(p)) return true;
  }
  return false;
}

/**
 * Decide whether a held scope is valid for the current environment.
 * Returns:
 *   "ok"                 → allowed in this env
 *   "sandbox_only"       → scope is sandbox-only; reject with sandbox_endpoint_required
 *   "production_only"    → scope is production-only; reject with production_endpoint_required
 *   "unknown"            → not in the V1 catalogue; reject with unknown_scope
 *   "forbidden"          → reject with forbidden_scope (defence-in-depth; DB trigger already blocks issuance)
 */
export function classifyScopeForEnv(
  scope: string,
  env: V1Environment,
): "ok" | "sandbox_only" | "production_only" | "unknown" | "forbidden" {
  if (isForbiddenV1Scope(scope)) return "forbidden";
  const def = SCOPE_BY_NAME.get(scope);
  if (!def) return "unknown";
  if (def.envRule === "both") return "ok";
  if (def.envRule === "sandbox") return env === "sandbox" ? "ok" : "sandbox_only";
  if (def.envRule === "production") return env === "production" ? "ok" : "production_only";
  return "unknown";
}

// ─── Canonical V1 route classification ───────────────────────────────────

export interface V1RouteDefinition {
  /** Stable, low-cardinality endpoint tag (matches logV1Request endpoint). */
  endpointTag: string;
  /** Canonical path template. */
  pathTemplate: string;
  /** HTTP method. */
  method: "GET" | "POST";
  classification: V1RouteClassification;
  /** Required scope on the API key. */
  requiredScope: string;
  /** True if the route may only ever READ; never writes platform state. */
  readOnly: true; // V1 is hard read-only by construction.
  /** Non-billable by design (health/status/docs/usage/sandbox/error tests). */
  alwaysNonBillable: boolean;
}

/**
 * Canonical V1 route table. Adding a row here is the contract for the
 * gateway, the OpenAPI spec, and the Batch 4 test pack. Any new V1 route
 * MUST be classified here before it ships.
 */
export const V1_ROUTES: ReadonlyArray<V1RouteDefinition> = [
  { endpointTag: "v1.health",                pathTemplate: "/v1/health",                       method: "GET",  classification: "both",            requiredScope: "api:status_read",        readOnly: true, alwaysNonBillable: true },
  { endpointTag: "v1.status",                pathTemplate: "/v1/status",                       method: "GET",  classification: "both",            requiredScope: "api:status_read",        readOnly: true, alwaysNonBillable: true },
  { endpointTag: "v1.docs.openapi",          pathTemplate: "/v1/docs/openapi.json",            method: "GET",  classification: "both",            requiredScope: "api:status_read",        readOnly: true, alwaysNonBillable: true },
  { endpointTag: "v1.docs.readable",         pathTemplate: "/v1/docs",                         method: "GET",  classification: "both",            requiredScope: "api:status_read",        readOnly: true, alwaysNonBillable: true },
  { endpointTag: "v1.counterparty.lookup",   pathTemplate: "/v1/counterparty/lookup",          method: "POST", classification: "both",            requiredScope: "counterparty:lookup",    readOnly: true, alwaysNonBillable: false },
  { endpointTag: "v1.counterparty.summary",  pathTemplate: "/v1/counterparty/{id}/summary",    method: "GET",  classification: "both",            requiredScope: "profile:summary_read",   readOnly: true, alwaysNonBillable: false },
  { endpointTag: "v1.test.error",            pathTemplate: "/v1/test/error/{code}",            method: "GET",  classification: "sandbox_only",    requiredScope: "api:status_read",        readOnly: true, alwaysNonBillable: true },
];

/** Forbidden write-action patterns. Used by the Batch 4 invariant test
 *  to assert no V1 route names hint at write/governance/payment surfaces. */
export const V1_FORBIDDEN_ROUTE_PATTERNS: ReadonlyArray<RegExp> = [
  /\/v1\/.*\/(create|delete|update|upload|approve|clear|verify|issue|override|export)\b/i,
  /\/v1\/(orgs|profile|profiles|documents|evidence|payments|compliance|verification|governance|poi|wad|bank|pricing|packages|scopes)\b/i,
];

/** Deterministic sandbox error catalogue (Batch 4 §3). */
export const SANDBOX_TEST_ERROR_CODES = [
  "invalid_api_key",
  "expired_api_key",
  "insufficient_scope",
  "missing_required_field",
  "invalid_country",
  "rate_limit_exceeded",
  "provider_unavailable",
  "internal_error_simulated",
] as const;
export type SandboxTestErrorCode = typeof SANDBOX_TEST_ERROR_CODES[number];

export const SANDBOX_TEST_ERROR_HTTP: Record<SandboxTestErrorCode, number> = {
  invalid_api_key: 401,
  expired_api_key: 401,
  insufficient_scope: 403,
  missing_required_field: 400,
  invalid_country: 400,
  rate_limit_exceeded: 429,
  provider_unavailable: 503,
  internal_error_simulated: 500,
};

export function isSandboxTestErrorCode(s: string): s is SandboxTestErrorCode {
  return (SANDBOX_TEST_ERROR_CODES as readonly string[]).includes(s);
}
