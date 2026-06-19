/**
 * Public API V1 · Batch 3 — Gateway entrypoint.
 *
 * Implements only the safe read-only foundation:
 *   GET /v1/health   → liveness probe (requires api:status_read)
 *   GET /v1/status   → key/client status echo (requires api:status_read)
 *
 * All requests go through runGateway() in _shared/public-api-v1.ts which
 * enforces: env header, X-API-Key, key status/expiry, environment match,
 * linked api_client status, IP allowlist, required scope, rate limit.
 * Each request writes exactly one row into api_request_logs with the
 * Batch 2 columns populated (billable=false, scope_used, environment,
 * external_reference, error_code).
 *
 * Hard exclusions for Batch 3 — no counterparty lookup, no counterparty
 * summary, no usage/current, no /v1/docs, no OpenAPI, no sandbox seed
 * records, no billing, no dashboards, no support intake, no webhook
 * changes, no write paths, no POI/WaD/payment/credit/compliance/
 * verification decisions, no document/evidence exposure.
 */

import { handleV1, jsonResponse, errorBody } from "../_shared/public-api-v1.ts";
import { corsHeaders as buildCorsHeaders } from "../_shared/cors.ts";

const V1_SCOPE = "api:status_read";

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = buildCorsHeaders(allowedOrigins, req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  const url = new URL(req.url);
  // Strip /functions/v1/public-api prefix; what remains is the V1 path.
  const parts = url.pathname.split("/").filter(Boolean);
  while (parts.length && parts[0] !== "v1") parts.shift();

  // GET /v1/health
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "health" && parts.length === 2) {
    return handleV1(req, "v1.health", "/v1/health", V1_SCOPE, async (ctx) => ({
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
    return handleV1(req, "v1.status", "/v1/status", V1_SCOPE, async (ctx, _supabase, gw) => {
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

  // Unknown V1 path — return canonical 404 envelope, but do NOT leak
  // implementation details or table names.
  const requestId = crypto.randomUUID();
  return jsonResponse(
    errorBody("no_match", requestId, null),
    404,
    { ...headers, "X-Request-Id": requestId },
  );
});
