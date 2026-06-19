/**
 * Public API V1 · Batch 3 — Gateway foundation.
 *
 * Centralises the canonical V1 error catalogue, the standard V1 error
 * response shape, environment detection, the per-request validation chain
 * (API key + api_client status + environment match + scope + IP allowlist
 * + rate limit), and request logging into the Batch 2 api_request_logs
 * columns (billable, scope_used, environment, external_reference,
 * error_code).
 *
 * Hard exclusions: no business endpoints, no billing, no docs/OpenAPI, no
 * sandbox seed records, no dashboards, no webhook changes, no POI / WaD /
 * payment / credit / compliance / verification logic.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as buildCorsHeaders } from "./cors.ts";
import { hashApiKey, hashApiKeySHA256, verifyScrypt } from "./auth.ts";
import { scopeSatisfies } from "./api-scopes.ts";
import { writeSecurityAudit } from "./security-audit.ts";
import { checkRateLimit } from "./rate-limit.ts";
import {
  beginApiActiveRequest,
  finishApiActiveRequest,
  evaluateMonthlyAllowance,
  thresholdsCrossed,
  recordThresholdOnce,
  auditMonthlyBlock,
  auditConcurrencyBlock,
  isCountableEndpoint,
  V1_DEFAULT_CONCURRENCY,
} from "./public-api-v1-usage.ts";
import { getActivePlanForClient } from "./public-api-v1-billing.ts";

// ─── Canonical V1 error catalogue ────────────────────────────────────────
export const V1_ERROR_CODES = [
  "invalid_api_key",
  "expired_api_key",
  "insufficient_scope",
  "suspended_key",
  "revoked_key",
  "missing_required_field",
  "invalid_country",
  "unsupported_country",
  "invalid_identifier_format",
  "rate_limit_exceeded",
  "monthly_limit_reached",
  "sandbox_record_only",
  "production_access_required",
  "no_match",
  "multiple_possible_matches",
  "provider_unavailable",
  "timeout",
  "internal_error",
] as const;
export type V1ErrorCode = typeof V1_ERROR_CODES[number];

const ERROR_HTTP_STATUS: Record<V1ErrorCode, number> = {
  invalid_api_key: 401,
  expired_api_key: 401,
  suspended_key: 401,
  revoked_key: 401,
  insufficient_scope: 403,
  missing_required_field: 400,
  invalid_country: 400,
  unsupported_country: 400,
  invalid_identifier_format: 400,
  rate_limit_exceeded: 429,
  monthly_limit_reached: 429,
  sandbox_record_only: 403,
  production_access_required: 403,
  no_match: 404,
  multiple_possible_matches: 409,
  provider_unavailable: 502,
  timeout: 504,
  internal_error: 500,
};

// Public-safe messages — never embed internal exception text.
const ERROR_PUBLIC_MESSAGE: Record<V1ErrorCode, string> = {
  invalid_api_key: "The API key is invalid.",
  expired_api_key: "The API key has expired.",
  suspended_key: "The API key is suspended.",
  revoked_key: "The API key has been revoked.",
  insufficient_scope: "The API key is missing a required scope.",
  missing_required_field: "A required field is missing from the request.",
  invalid_country: "The country value is not valid.",
  unsupported_country: "The country is not supported by this API client.",
  invalid_identifier_format: "An identifier in the request is malformed.",
  rate_limit_exceeded: "Rate limit exceeded. Slow down and retry.",
  monthly_limit_reached: "Monthly request allowance reached.",
  sandbox_record_only: "Production access required for this resource.",
  production_access_required: "Production access required for this resource.",
  no_match: "No matching record was found.",
  multiple_possible_matches: "More than one possible match — refine the request.",
  provider_unavailable: "A downstream provider is temporarily unavailable.",
  timeout: "The request timed out.",
  internal_error: "An internal error occurred.",
};

// ─── Standard V1 response envelopes ──────────────────────────────────────
export interface V1RequestCtx {
  requestId: string;
  startedAt: number;
  environment: "sandbox" | "production" | null;
  actorIp: string | null;
  userAgent: string | null;
  origin: string | null;
  externalReference: string | null;
  endpointTag: string;            // stable, low-cardinality (e.g. "v1.health")
  scopeUsed: string | null;
  apiKeyId: string | null;
  orgId: string | null;
  apiClientId: string | null;
  // Batch 5 — set by the endpoint executor when a successful response
  // represents a billable production call. Health/status/sandbox/validation/
  // auth/scope/system errors must leave this false.
  billable: boolean;
  responseHeaders: Record<string, string>;
}

export function newCtx(req: Request, endpointTag: string): V1RequestCtx {
  return {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    environment: null,
    actorIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
    origin: req.headers.get("origin") ?? null,
    externalReference: req.headers.get("x-external-reference") ?? null,
    endpointTag,
    scopeUsed: null,
    apiKeyId: null,
    orgId: null,
    apiClientId: null,
    billable: false,
    responseHeaders: {},
  };
}

export function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorBody(code: V1ErrorCode, requestId: string, retryAfter: number | null = null) {
  return {
    request_id: requestId,
    error_code: code,
    message: ERROR_PUBLIC_MESSAGE[code],
    timestamp: new Date().toISOString(),
    retry_after: retryAfter,
  };
}

export class V1Error extends Error {
  constructor(public code: V1ErrorCode, public retryAfter: number | null = null) {
    super(code);
  }
}

// ─── Environment detection ───────────────────────────────────────────────
// Header `X-Izenzo-Environment: sandbox|production` is the V1 contract.
// Missing header → null (later mapped to insufficient_scope/invalid).
export function detectEnvironment(req: Request): "sandbox" | "production" | null {
  const raw = (req.headers.get("x-izenzo-environment") || "").trim().toLowerCase();
  if (raw === "sandbox" || raw === "production") return raw;
  return null;
}

// ─── API key lookup (same hashing rules as _shared/auth.ts) ──────────────
async function lookupApiKey(
  supabase: SupabaseClient,
  presented: string,
): Promise<any | null> {
  const { data: keys, error } = await supabase
    .from("api_keys")
    .select("id, org_id, scopes, status, key_hash, expires_at, allowed_ips, allowed_origins, name, api_client_id, environment");
  if (error || !keys) return null;
  for (const k of keys as any[]) {
    let isMatch = false;
    if (typeof k.key_hash === "string" && k.key_hash.includes("$")) {
      isMatch = await verifyScrypt(presented, k.key_hash);
    } else if (typeof k.key_hash === "string" && k.key_hash.length === 64 && /^[0-9a-f]+$/.test(k.key_hash)) {
      const sha = await hashApiKeySHA256(presented);
      isMatch = sha === k.key_hash;
      if (isMatch) {
        // Opportunistic rehash to scrypt — same pattern as auth.ts.
        const newHash = await hashApiKey(presented);
        await supabase.from("api_keys").update({ key_hash: newHash }).eq("id", k.id);
      }
    }
    if (isMatch) return k;
  }
  return null;
}

// ─── Request log writer ──────────────────────────────────────────────────
export async function logV1Request(
  supabase: SupabaseClient,
  ctx: V1RequestCtx,
  endpointPath: string,
  method: string,
  statusCode: number,
  errorCode: V1ErrorCode | null,
): Promise<void> {
  try {
    await supabase.from("api_request_logs").insert({
      org_id: ctx.orgId,
      api_key_id: ctx.apiKeyId,
      endpoint: endpointPath,
      method,
      status_code: statusCode,
      response_time_ms: Date.now() - ctx.startedAt,
      ip_address: ctx.actorIp,
      user_agent: ctx.userAgent,
      request_id: ctx.requestId,
      // Batch 2 additive columns; billable comes from ctx (Batch 5).
      // Health/status/sandbox/validation/auth/scope/system-error paths
      // never set ctx.billable, so the default is false here.
      billable: errorCode === null ? ctx.billable : false,
      scope_used: ctx.scopeUsed,
      environment: ctx.environment,
      external_reference: ctx.externalReference,
      error_code: errorCode,
    });
  } catch (e) {
    // Logging must never break the response.
    console.error("[public-api] log insert failed:", (e as Error).message);
  }
}

// ─── Audit helpers ───────────────────────────────────────────────────────
async function audit(
  supabase: SupabaseClient,
  action: string,
  ctx: V1RequestCtx,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeSecurityAudit({
    action,
    orgId: ctx.orgId,
    apiKeyId: ctx.apiKeyId,
    actorIp: ctx.actorIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    extra: { endpoint: ctx.endpointTag, environment: ctx.environment, ...extra },
  }, supabase).catch(() => {});
}

// ─── Gateway validation chain ────────────────────────────────────────────
//
// Returns the matched api_key row + linked api_client (if any). Throws
// V1Error on any validation failure; the caller will log + respond with
// the canonical error envelope. Raw API keys are NEVER stored or logged.
export interface GatewayResult {
  apiKey: any;
  apiClient: { id: string; status: string } | null;
}

export async function runGateway(
  req: Request,
  supabase: SupabaseClient,
  ctx: V1RequestCtx,
  requiredScope: string,
): Promise<GatewayResult> {
  // 1. Environment header
  const env = detectEnvironment(req);
  if (!env) {
    throw new V1Error("missing_required_field");
  }
  ctx.environment = env;

  // 2. X-API-Key
  const presented = req.headers.get("x-api-key");
  if (!presented || typeof presented !== "string" || !presented.startsWith("sk_")) {
    await audit(supabase, "api_key.v1.invalid_key_attempt", ctx);
    throw new V1Error("invalid_api_key");
  }

  // 3. Lookup
  const key = await lookupApiKey(supabase, presented);
  if (!key) {
    await audit(supabase, "api_key.v1.invalid_key_attempt", ctx);
    throw new V1Error("invalid_api_key");
  }
  ctx.apiKeyId = key.id;
  ctx.orgId = key.org_id;
  ctx.apiClientId = key.api_client_id ?? null;

  // 4. Key status
  if (key.status === "revoked") {
    await audit(supabase, "api_key.v1.revoked_use_attempt", ctx);
    throw new V1Error("revoked_key");
  }
  if (key.status === "suspended") {
    await audit(supabase, "api_key.v1.suspended_use_attempt", ctx);
    throw new V1Error("suspended_key");
  }
  if (key.status !== "active") {
    await audit(supabase, "api_key.v1.invalid_key_attempt", ctx);
    throw new V1Error("invalid_api_key");
  }

  // 5. Expiry
  if (key.expires_at) {
    const exp = new Date(key.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) {
      await audit(supabase, "api_key.v1.expired_use_attempt", ctx);
      throw new V1Error("expired_api_key");
    }
  }

  // 6. Environment match (sandbox key may not access production, vice versa)
  if (key.environment && key.environment !== env) {
    if (env === "production") {
      await audit(supabase, "api_key.v1.environment_mismatch", ctx, { key_env: key.environment });
      throw new V1Error("production_access_required");
    }
    await audit(supabase, "api_key.v1.environment_mismatch", ctx, { key_env: key.environment });
    throw new V1Error("sandbox_record_only");
  }

  // 7. Linked api_client status
  let apiClient: { id: string; status: string } | null = null;
  if (key.api_client_id) {
    const { data: client } = await supabase
      .from("api_clients")
      .select("id, status")
      .eq("id", key.api_client_id)
      .maybeSingle();
    if (!client || client.status === "revoked") {
      await audit(supabase, "api_key.v1.client_revoked_use_attempt", ctx);
      throw new V1Error("revoked_key");
    }
    if (client.status === "suspended") {
      await audit(supabase, "api_key.v1.client_suspended_use_attempt", ctx);
      throw new V1Error("suspended_key");
    }
    apiClient = client;
  }

  // 8. IP allowlist (forbidden scopes already cannot grant access — see
  //    api-scopes.ts; this enforces production IP allowlist when set).
  const allowedIps: string[] | null = key.allowed_ips;
  if (allowedIps && allowedIps.length > 0) {
    if (!ctx.actorIp || !allowedIps.includes(ctx.actorIp)) {
      await audit(supabase, "api_key.v1.ip_blocked", ctx, { allowed_ip_count: allowedIps.length });
      throw new V1Error("insufficient_scope");
    }
  }

  // 9. Required scope (exact-match / explicit wildcard per api-scopes.ts)
  const held: string[] = Array.isArray(key.scopes) ? key.scopes : [];
  if (!scopeSatisfies(held, requiredScope)) {
    await audit(supabase, "api_key.v1.insufficient_scope", ctx, { required: requiredScope });
    throw new V1Error("insufficient_scope");
  }
  ctx.scopeUsed = requiredScope;

  // 10. Rate limit (60 rpm default via existing helper)
  try {
    await checkRateLimit(
      supabase,
      key.org_id,
      key.id,
      ctx.endpointTag,
      undefined,
      { actorIp: ctx.actorIp, userAgent: ctx.userAgent, requestId: ctx.requestId },
    );
  } catch (e) {
    const anyE = e as { code?: string; status?: number; details?: { retryAfter?: number } };
    if (anyE?.status === 429) {
      const retry = anyE.details?.retryAfter ?? null;
      throw new V1Error("rate_limit_exceeded", retry ?? null);
    }
    throw new V1Error("internal_error");
  }

  // Best-effort last_used_at update — never blocks the request.
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(() => {}, () => {});

  return { apiKey: key, apiClient };
}

// ─── Top-level handler wrapper ───────────────────────────────────────────
export async function handleV1<T>(
  req: Request,
  endpointTag: string,
  endpointPath: string,
  requiredScope: string,
  exec: (ctx: V1RequestCtx, supabase: SupabaseClient, gw: GatewayResult) => Promise<{ body: T; status?: number }>,
): Promise<Response> {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = buildCorsHeaders(allowedOrigins, req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const ctx = newCtx(req, endpointTag);
  let concurrencyHeld = false;
  const countable = isCountableEndpoint(endpointPath);

  try {
    const gw = await runGateway(req, supabase, ctx, requiredScope);

    // Batch 6 — concurrency guard (3 per api_key, best-effort, 30s TTL).
    // Applied to ALL V1 endpoints after auth so unauthenticated traffic
    // cannot starve the table.
    const begun = await beginApiActiveRequest(
      supabase, gw.apiKey.id, ctx.apiClientId, ctx.environment, ctx.requestId,
    );
    if (!begun.ok) {
      await auditConcurrencyBlock(supabase, ctx, gw.apiKey.id, begun.active);
      throw new V1Error("rate_limit_exceeded", 1);
    }
    concurrencyHeld = true;

    // Batch 6 — monthly allowance gate (countable endpoints only).
    let preState: Awaited<ReturnType<typeof evaluateMonthlyAllowance>> | null = null;
    if (countable && ctx.apiClientId && (ctx.environment === "sandbox" || ctx.environment === "production")) {
      preState = await evaluateMonthlyAllowance(supabase, ctx.apiClientId, ctx.environment);
      if (preState.blocked) {
        await auditMonthlyBlock(supabase, ctx, ctx.apiClientId, ctx.environment, preState);
        throw new V1Error("monthly_limit_reached");
      }
    }

    const result = await exec(ctx, supabase, gw);
    const status = result.status ?? 200;
    await logV1Request(supabase, ctx, endpointPath, req.method, status, null);

    // Batch 6 — post-success threshold detection (countable endpoints only).
    if (countable && preState && ctx.apiClientId && (ctx.environment === "sandbox" || ctx.environment === "production")) {
      const postCurrent = preState.current + 1;
      const crossed = thresholdsCrossed(preState.current, postCurrent, preState.limit);
      for (const t of crossed) {
        await recordThresholdOnce(
          supabase, ctx, ctx.apiClientId, ctx.environment, t,
          { ...preState, current: postCurrent },
        );
      }
    }

    return jsonResponse(result.body, status, { ...headers, "X-Request-Id": ctx.requestId });
  } catch (e) {
    const v1err = e instanceof V1Error ? e : new V1Error("internal_error");
    const status = ERROR_HTTP_STATUS[v1err.code];
    const body = errorBody(v1err.code, ctx.requestId, v1err.retryAfter);
    const extraHeaders: Record<string, string> = { ...headers, "X-Request-Id": ctx.requestId };
    if (v1err.retryAfter && Number.isFinite(v1err.retryAfter)) {
      extraHeaders["Retry-After"] = String(v1err.retryAfter);
    }
    await logV1Request(supabase, ctx, endpointPath, req.method, status, v1err.code);
    return jsonResponse(body, status, extraHeaders);
  } finally {
    if (concurrencyHeld) {
      await finishApiActiveRequest(supabase, ctx.requestId);
    }
  }
}

// Re-export for external static introspection (tests / panels).
export { V1_DEFAULT_CONCURRENCY };
