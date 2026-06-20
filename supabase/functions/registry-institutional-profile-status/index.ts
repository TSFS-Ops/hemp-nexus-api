// Batch 5 — M008 Institutional Verified-Profile Status API facade.
// Returns SAFE STATUS ONLY. Never returns raw bank details. Consults the
// Business Decision Register before declaring a record institutionally usable.
//
// Canonical audit events emitted:
//   - registry_api_profile_status_requested
//   - registry_api_response_returned
//   - registry_api_scope_denied
//   - registry_api_request_blocked
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_API_RESULT_EXPLANATIONS,
  REGISTRY_API_SCOPES,
  isProfileInstitutionallyUsable,
  type RegistryApiResultState,
} from "../_shared/registry-institutional-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  company_reference: z.string().min(1).max(120),
  scope: z.enum(REGISTRY_API_SCOPES).default("registry.profile.status.read"),
});

interface AuthedClient {
  client_id: string;
  key_id: string;
  environment: string;
  scopes: string[];
}

async function authenticate(
  svc: ReturnType<typeof createClient>,
  req: Request,
): Promise<AuthedClient | null> {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey || !apiKey.startsWith("rk_")) return null;
  const prefix = apiKey.split("_").slice(0, 3).join("_");
  // Look up by prefix and verify hash. Hash check is done by Deno locally.
  const { hashApiKey } = await import("../_shared/registry-institutional-api.ts");
  const expectedHash = await hashApiKey(apiKey);
  const { data } = await svc
    .from("registry_api_keys")
    .select("id, client_id, environment, status, key_hash")
    .eq("key_prefix", prefix)
    .eq("status", "active")
    .maybeSingle();
  if (!data || data.key_hash !== expectedHash) return null;
  const { data: client } = await svc
    .from("registry_api_clients")
    .select("scopes, status")
    .eq("id", data.client_id)
    .maybeSingle();
  if (!client || client.status !== "active") return null;
  return {
    client_id: data.client_id,
    key_id: data.id,
    environment: data.environment,
    scopes: client.scopes ?? [],
  };
}

async function logRequest(
  svc: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  await svc.from("registry_api_request_logs").insert(row).catch(() => {});
}

async function audit(
  svc: ReturnType<typeof createClient>,
  name: string,
  payload: Record<string, unknown>,
  clientId: string | null,
  keyId: string | null,
) {
  await svc
    .from("registry_api_audit_events")
    .insert({ audit_event_name: name, client_id: clientId, key_id: keyId, payload })
    .catch(() => {});
  await svc
    .from("event_store")
    .insert({ event_name: name, aggregate_type: "registry_api", payload })
    .catch(() => {});
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  const requestId = crypto.randomUUID();
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const auth = await authenticate(svc, req);
    if (!auth) {
      await audit(svc, "registry_api_request_blocked", { reason: "unauthorized", request_id: requestId }, null, null);
      return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, result_state: "not_usable", safe_explanation: "Authentication failed." }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      await audit(svc, "registry_api_request_blocked", { reason: "invalid_body", request_id: requestId }, auth.client_id, auth.key_id);
      return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const { company_reference, scope } = parsed.data;

    // Scope enforcement.
    if (!auth.scopes.includes(scope)) {
      await audit(svc, "registry_api_scope_denied", { scope, request_id: requestId }, auth.client_id, auth.key_id);
      await logRequest(svc, {
        client_id: auth.client_id, key_id: auth.key_id, environment: auth.environment,
        endpoint: "registry-institutional-profile-status", scope_requested: scope, scope_granted: false,
        result_state: "not_usable", status_code: 403, request_id: requestId,
      });
      return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, result_state: "not_usable", safe_explanation: "Scope not granted to this client." }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    await audit(svc, "registry_api_profile_status_requested", { company_reference, scope, request_id: requestId }, auth.client_id, auth.key_id);

    // Batch 5 has no production registry data. Compute the safest possible
    // result state by consulting coverage + claim + authority + provenance +
    // Business Decision Register.
    let result_state: RegistryApiResultState = "not_ready";
    let profile_verified = false;
    const authority_approved = false; // shell — no records exist
    const has_sufficient_provenance = false;
    const business_decision_approved = false;

    // Country coverage lookup (best effort; we have no country in the request
    // so we cannot block on seed_only here — we degrade safely to not_ready).
    // Existing batches do enforce per-country gates.

    // Consult Business Decision Register: api_output category, approved status.
    const { data: decisions } = await svc
      .from("business_decisions")
      .select("id, category, status, scope_key")
      .eq("category", "api_output")
      .eq("status", "approved")
      .limit(50);
    const bdApproved = !!(decisions ?? []).find((d: { scope_key: string | null }) =>
      d.scope_key === company_reference || d.scope_key === "*"
    );

    if (!bdApproved) {
      result_state = "business_decision_required";
    } else {
      const usable = isProfileInstitutionallyUsable({
        profile_verified, authority_approved, has_sufficient_provenance,
        coverage_state: "shell_ready", business_decision_approved: bdApproved,
      });
      result_state = usable ? "usable" : "insufficient_authority";
    }

    const body = {
      ok: true,
      request_id: requestId,
      api_client_id: auth.client_id,
      company_reference,
      company_name: null,
      country: null,
      registration_number: null,
      profile_status: "profile_not_verified",
      claim_status: "unclaimed",
      authority_status: "authority_pending",
      provenance_summary: { sources_recorded: 0, sufficient: false },
      country_coverage_status: "shell_ready",
      readiness_status: "shell_ready",
      confidence_rating: "insufficient_evidence",
      last_reviewed_at: null,
      expiry_at: null,
      result_state,
      safe_explanation: REGISTRY_API_RESULT_EXPLANATIONS[result_state],
      audit_reference: requestId,
    };

    await logRequest(svc, {
      client_id: auth.client_id, key_id: auth.key_id, environment: auth.environment,
      endpoint: "registry-institutional-profile-status", scope_requested: scope, scope_granted: true,
      result_state, status_code: 200, request_id: requestId,
      payload_summary: { company_reference },
    });
    await audit(svc, "registry_api_response_returned", { endpoint: "registry-institutional-profile-status", result_state, request_id: requestId }, auth.client_id, auth.key_id);

    return withCors(req, new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-institutional-profile-status error", err);
    return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
