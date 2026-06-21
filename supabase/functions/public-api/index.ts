/**
 * Public API V1 — Gateway entrypoint.
 *
 * Batch 3 routes:
 *   GET  /v1/health                    → api:status_read
 *   GET  /v1/status                    → api:status_read
 *
 * Batch 5 routes (read-only institutional signal layer):
 *   POST /v1/counterparty/lookup       → counterparty:lookup (+ signals:read)
 *   GET  /v1/counterparty/{id}/summary → profile:summary_read (+ signals:read)
 *
 * Every request flows through runGateway() in _shared/public-api-v1.ts
 * which enforces env header, X-API-Key, key status/expiry, environment
 * match, linked api_client status, IP allowlist, required scope and rate
 * limit. Every request body flows through the Batch 5 allowlist mapper
 * (_shared/public-api-v1-counterparty.ts) so only approved fields can
 * leave the surface. Sandbox calls read ONLY from api_sandbox_records;
 * production calls remain conservative (no_match) until a safe approved
 * production source is wired in a later batch.
 *
 * Hard exclusions still in force: no /v1/usage/current, no /v1/docs, no
 * OpenAPI, no billing, no dashboards, no support intake, no webhook
 * changes, no write paths, no document/evidence exposure, no internal
 * tables touched, no POI/WaD/payment/credit/compliance/verification
 * decisions.
 */

import { handleV1, jsonResponse, errorBody, V1Error, detectEnvironmentDetailed } from "../_shared/public-api-v1.ts";
import { corsHeaders as buildCorsHeaders } from "../_shared/cors.ts";
import {
  validateLookupInput,
  resolveSandboxRow,
  dispatchSandboxRow,
  buildNoMatchEnvelope,
  buildSummaryEnvelope,
  assertNoForbiddenFields,
  type LookupInput,
} from "../_shared/public-api-v1-counterparty.ts";
import {
  buildOpenApiSpec,
  buildReadableDocsHtml,
} from "../_shared/public-api-v1-openapi.ts";
import {
  isSandboxTestErrorCode,
  SANDBOX_TEST_ERROR_HTTP,
  type SandboxTestErrorCode,
} from "../_shared/public-api-v1-scopes.ts";

const V1_SCOPE = "api:status_read";
// Back-compat alias preserved so Batch-5 routes can refer by their role.
const V1_STATUS_SCOPE = V1_SCOPE;
const V1_DOCS_SCOPE = V1_SCOPE;
const V1_LOOKUP_SCOPE = "counterparty:lookup";
const V1_SUMMARY_SCOPE = "profile:summary_read";
// Signals scope check — applied in-handler because the response carries
// risk_signal_summary / verification_status (signal-bearing fields).
const V1_SIGNALS_SCOPE = "signals:read";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicServerUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = buildCorsHeaders(allowedOrigins, req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  while (parts.length && parts[0] !== "v1") parts.shift();

  // GET /v1/health
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "health" && parts.length === 2) {
    return handleV1(req, "v1.health", "/v1/health", V1_STATUS_SCOPE, async (ctx) => ({
      body: {
        request_id: ctx.requestId,
        environment: ctx.environment,
        status: "ok",
        service: "public_api",
        timestamp: new Date().toISOString(),
      },
    }));
  }

  // GET /v1/status
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "status" && parts.length === 2) {
    return handleV1(req, "v1.status", "/v1/status", V1_STATUS_SCOPE, async (ctx, _supabase, gw) => {
      const expires_at = gw.apiKey.expires_at ?? null;
      const expired = expires_at ? new Date(expires_at).getTime() <= Date.now() : false;
      return {
        body: {
          request_id: ctx.requestId,
          environment: ctx.environment,
          api_client_status: gw.apiClient?.status ?? null,
          key_status: expired ? "expired" : gw.apiKey.status,
          scopes: Array.isArray(gw.apiKey.scopes) ? gw.apiKey.scopes : [],
          expires_at,
          timestamp: new Date().toISOString(),
        },
      };
    });
  }

  // GET /v1/docs/openapi.json — single source-of-truth machine-readable spec.
  // Non-billable; logged; requires valid API key + api:status_read.
  if (
    req.method === "GET" &&
    parts[0] === "v1" && parts[1] === "docs" && parts[2] === "openapi.json" && parts.length === 3
  ) {
    return handleV1(req, "v1.docs.openapi", "/v1/docs/openapi.json", V1_DOCS_SCOPE, async (ctx) => {
      ctx.billable = false;
      const spec = buildOpenApiSpec(publicServerUrl(req));
      return { body: spec };
    });
  }

  // GET /v1/docs — readable HTML documentation, served from the SAME
  // source-of-truth module as the OpenAPI spec. Non-billable; logged.
  if (
    req.method === "GET" &&
    parts[0] === "v1" && parts[1] === "docs" && parts.length === 2
  ) {
    return handleV1(req, "v1.docs.readable", "/v1/docs", V1_DOCS_SCOPE, async (ctx) => {
      ctx.billable = false;
      const html = buildReadableDocsHtml(publicServerUrl(req));
      return { body: { ok: true }, contentType: "text/html; charset=utf-8", rawBody: html };
    });
  }

  // POST /v1/counterparty/lookup
  if (
    req.method === "POST" &&
    parts[0] === "v1" && parts[1] === "counterparty" && parts[2] === "lookup" && parts.length === 3
  ) {
    return handleV1(req, "v1.counterparty.lookup", "/v1/counterparty/lookup", V1_LOOKUP_SCOPE, async (ctx, supabase, gw) => {
      // Signal-bearing response → require signals:read in addition.
      const held: string[] = Array.isArray(gw.apiKey.scopes) ? gw.apiKey.scopes : [];
      if (!held.includes(V1_SIGNALS_SCOPE) && !held.includes("signals:*")) {
        throw new V1Error("insufficient_scope");
      }

      // Parse + validate body
      let payload: LookupInput;
      try {
        payload = (await req.json()) as LookupInput;
        if (!payload || typeof payload !== "object") throw new Error("bad");
      } catch {
        throw new V1Error("missing_required_field");
      }
      const input = validateLookupInput(payload);
      // External reference may also be supplied in the body.
      if (!ctx.externalReference && input.external_reference) {
        ctx.externalReference = input.external_reference;
      }

      if (ctx.environment === "sandbox") {
        // Sandbox calls are NEVER billable.
        ctx.billable = false;
        const { row } = await resolveSandboxRow(supabase, input);
        if (!row) {
          return { body: buildNoMatchEnvelope(ctx) };
        }
        const body = dispatchSandboxRow(ctx, row);
        assertNoForbiddenFields(body);
        return { body };
      }

      // Production path — CONSERVATIVE.
      // No safe approved production source for public API lookup exists
      // yet; we return a no_match envelope rather than expose internal
      // tables. If a successful production match becomes available in a
      // later batch, mark `ctx.billable = true` ONLY then.
      ctx.billable = false; // no successful production data returned yet
      const body = buildNoMatchEnvelope(ctx);
      // Sentinel: production successful lookups WILL set billable=true.
      // (This branch is currently unreachable; left here as a binding
      // contract for the later production-source batch.)
      // if (productionMatchFound) { ctx.billable = true; }
      assertNoForbiddenFields(body);
      return { body };
    });
  }

  // GET /v1/counterparty/{id}/summary
  if (
    req.method === "GET" &&
    parts[0] === "v1" && parts[1] === "counterparty" && parts[3] === "summary" && parts.length === 4
  ) {
    return handleV1(req, "v1.counterparty.summary", "/v1/counterparty/summary", V1_SUMMARY_SCOPE, async (ctx, supabase, gw) => {
      const held: string[] = Array.isArray(gw.apiKey.scopes) ? gw.apiKey.scopes : [];
      if (!held.includes(V1_SIGNALS_SCOPE) && !held.includes("signals:*")) {
        throw new V1Error("insufficient_scope");
      }
      const id = parts[2];
      if (!id || !UUID_RE.test(id)) throw new V1Error("invalid_identifier_format");

      if (ctx.environment === "sandbox") {
        ctx.billable = false;
        const { data: row, error } = await supabase
          .from("api_sandbox_records")
          .select("*")
          .eq("id", id)
          .eq("active", true)
          .maybeSingle();
        if (error || !row) throw new V1Error("no_match");
        // Marker-only scenarios should never be returned as a summary —
        // they have no real legal entity fields.
        if (!row.legal_name) throw new V1Error("no_match");
        const body = buildSummaryEnvelope(ctx, row);
        assertNoForbiddenFields(body);
        return { body };
      }

      // Production path — conservative; no internal tables exposed.
      // Sandbox-only records must never be returned to production keys.
      ctx.billable = false;
      throw new V1Error("no_match");
    });
  }

  // GET /v1/test/error/{code} — Sandbox / Production Separation · Batch 4.
  //
  // Deterministic sandbox-only error route. Production hostnames must
  // reject this route BEFORE any simulation runs so production keys can
  // never produce a forged error envelope. Sandbox calls are always
  // non-billable (ctx.billable=false) and log token_cost-equivalent=0.
  if (
    req.method === "GET" &&
    parts[0] === "v1" && parts[1] === "test" && parts[2] === "error" && parts.length === 4
  ) {
    // Host-derived environment must be sandbox. We check this BEFORE
    // invoking handleV1 so the route literally does not exist in
    // production: production hosts return sandbox_endpoint_required and
    // never enter the simulation branch.
    const detected = detectEnvironmentDetailed(req);
    if (detected.env === "production") {
      const requestId = crypto.randomUUID();
      return jsonResponse(
        errorBody("sandbox_endpoint_required", requestId, null),
        403,
        {
          ...headers,
          "X-Request-Id": requestId,
          "X-Izenzo-Request-Id": requestId,
          "X-Izenzo-Environment": "production",
        },
      );
    }

    const code = parts[3];
    if (!isSandboxTestErrorCode(code)) {
      const requestId = crypto.randomUUID();
      return jsonResponse(
        errorBody("missing_required_field", requestId, null),
        400,
        {
          ...headers,
          "X-Request-Id": requestId,
          "X-Izenzo-Request-Id": requestId,
          "X-Izenzo-Environment": detected.env ?? "unknown",
        },
      );
    }

    return handleV1(req, "v1.test.error", `/v1/test/error/${code}`, V1_STATUS_SCOPE, async (ctx) => {
      // Sandbox error simulations are NEVER billable. Defence-in-depth:
      // also reject any non-sandbox env that slipped through (host-derived
      // env is authoritative — see runGateway env match check).
      ctx.billable = false;
      if (ctx.environment !== "sandbox") {
        throw new V1Error("sandbox_endpoint_required");
      }
      const c = code as SandboxTestErrorCode;
      const retry = c === "rate_limit_exceeded" ? 60 : null;
      // Throw via V1Error so the canonical envelope + HTTP status comes
      // from the central error table — proves response shape parity with
      // real production errors.
      throw new V1Error(c, retry);
    });
  }


  // Unknown V1 path — return canonical 404 envelope, never leak internals.
  const requestId = crypto.randomUUID();
  const fallbackEnv = detectEnvironmentDetailed(req).env ?? "unknown";
  return jsonResponse(
    errorBody("no_match", requestId, null),
    404,
    {
      ...headers,
      "X-Request-Id": requestId,
      "X-Izenzo-Request-Id": requestId,
      "X-Izenzo-Environment": fallbackEnv,
    },
  );
});
