/**
 * api-usage-self-summary
 *
 * Internal, app-authenticated endpoint that returns the LATEST API usage
 * summary for the caller's own organisation's API clients.
 *
 * Scope (binding):
 *   • Callable only by authenticated app users (Supabase JWT).
 *   • Re-uses existing gates: `is_org_admin` (via `can_view_api_client_usage`)
 *     and the SECURITY DEFINER RPC `get_api_client_usage_summary` for the
 *     actual derivation. No bespoke usage math.
 *   • Returns ONLY the caller's own org's API clients. No cross-client,
 *     no cross-org. The caller's JWT is passed to the RPC so every per-client
 *     summary is re-checked server-side.
 *   • Strips any field that could leak payloads, full keys, secrets,
 *     internal notes or alert internals before returning.
 *
 * Hard exclusions (preserved):
 *   • NOT a Public API V1 route. Lives outside /v1/*.
 *   • NO X-API-Key auth. JWT only.
 *   • NEVER billable. NEVER exposed in OpenAPI.
 *   • Does NOT touch api_usage_alerts. Does NOT change Public API V1
 *     hard exclusion (no /v1/usage/current).
 */

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { corsHeaders as buildCorsHeaders } from "../_shared/cors.ts";

// Fields that must NEVER appear in the response body. Defensive scrub:
// the source RPC is already safe today; this guarantees future drift
// cannot leak them through this endpoint.
const FORBIDDEN_FIELDS = [
  "request_body",
  "response_body",
  "api_key",
  "key_hash",
  "raw_key",
  "secret",
  "token",
  "stack",
  "stack_trace",
  "latest_note",
  "internal_note",
  "ip_address",
  "user_agent",
];

function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELDS.includes(k)) continue;
      out[k] = scrub(v);
    }
    return out as unknown as T;
  }
  return value;
}

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = buildCorsHeaders(allowedOrigins, req.headers.get("origin"));
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // JWT-bound client — all RPCs run as the caller, so existing
  // SECURITY DEFINER gates (`can_view_api_client_usage`, `is_org_admin`)
  // re-enforce isolation server-side.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }
  const userId = claims.claims.sub as string;

  // Resolve caller's org_id from profiles (single source of truth).
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr || !profile?.org_id) {
    return new Response(JSON.stringify({ error: "no_organisation" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }
  const orgId = profile.org_id as string;

  // List api_clients belonging to the caller's org. RLS on api_clients
  // already restricts this list; we additionally constrain by org_id so
  // a misconfigured policy cannot widen the response.
  const { data: clients, error: clientsErr } = await supabase
    .from("api_clients")
    .select("id, legal_entity_name, status, org_id")
    .eq("org_id", orgId);
  if (clientsErr) {
    return new Response(JSON.stringify({ error: "lookup_failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const summaries: Array<Record<string, unknown>> = [];
  const denied: string[] = [];

  for (const c of clients ?? []) {
    // Defence-in-depth: drop anything that somehow slipped through with
    // a different org_id.
    if (c.org_id !== orgId) continue;

    const { data: summary, error: rpcErr } = await supabase.rpc(
      "get_api_client_usage_summary",
      { p_api_client_id: c.id },
    );
    if (rpcErr) {
      // Forbidden / not found → record id only, never leak DB messages.
      denied.push(c.id);
      continue;
    }
    summaries.push(scrub(summary as Record<string, unknown>));
  }

  return new Response(
    JSON.stringify({
      org_id: orgId,
      generated_at: new Date().toISOString(),
      api_client_count: summaries.length,
      summaries,
      denied_client_ids: denied,
    }),
    { status: 200, headers: jsonHeaders },
  );
});
