// Batch 15 — registry-api-profile-status (B15 hardened, additive to Batch 5).
// Returns SAFE STATUS ONLY. No raw bank details. No personal contact details.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { hashApiKey } from "../_shared/registry-institutional-api.ts";
import {
  buildResponseEnvelope,
  evaluateApiGates,
  gatesToBlockedReason,
  REGISTRY_API_DEFAULT_MODE,
  type RegistryApiHardenedResultState,
  type RegistryApiMode,
} from "../_shared/registry-api-hardening.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  company_reference: z.string().min(1).max(120),
  country: z.string().length(2).optional(),
  use_case: z.string().min(1).max(80).optional(),
  scope: z.string().default("registry.profile.status.read"),
  mode: z.string().default(REGISTRY_API_DEFAULT_MODE),
});

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function authenticate(svc: ReturnType<typeof createClient>, req: Request) {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey) return null;
  const prefix = apiKey.split("_").slice(0, 3).join("_");
  const expectedHash = await hashApiKey(apiKey);
  const { data: key } = await svc.from("registry_api_keys")
    .select("id, client_id, environment, status, key_hash, key_type")
    .eq("key_prefix", prefix).eq("status", "active").maybeSingle();
  if (!key || key.key_hash !== expectedHash) return null;
  const { data: client } = await svc.from("registry_api_clients")
    .select("id, lifecycle_status, mode, allowed_countries, allowed_use_cases, scopes")
    .eq("id", key.client_id).maybeSingle();
  if (!client) return null;
  const { data: scopeRows } = await svc.from("registry_api_client_scopes")
    .select("scope_key").eq("client_id", client.id).is("revoked_at", null);
  const grantedScopes = (scopeRows ?? []).map((r: { scope_key: string }) => r.scope_key)
    .concat(client.scopes ?? []);
  return { client, key, grantedScopes };
}

async function logUsage(
  svc: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  await svc.from("registry_api_usage_events").insert(row).catch(() => {});
}

async function logBlocked(
  svc: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  await svc.from("registry_api_blocked_events").insert(row).catch(() => {});
}

async function emitAudit(
  svc: ReturnType<typeof createClient>,
  name: string,
  clientId: string | null,
  payload: Record<string, unknown>,
) {
  await svc.from("registry_api_audit_events").insert({
    audit_event_name: name, client_id: clientId, payload,
  }).catch(() => {});
  await svc.from("event_store").insert({
    event_name: name, aggregate_type: "registry_api", payload,
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  const requestId = crypto.randomUUID();
  const ipHash = req.headers.get("cf-connecting-ip") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { ok: false, request_id: requestId, error: "invalid_body" });
    const body = parsed.data;
    const requestedMode = body.mode as RegistryApiMode;

    await emitAudit(svc, "registry_api_request_received", null, { request_id: requestId, endpoint: "profile-status" });

    const auth = await authenticate(svc, req);
    if (!auth) {
      await logBlocked(svc, {
        request_id: requestId, endpoint: "profile-status", scope: body.scope, mode: requestedMode,
        block_reason: "authentication_failed", block_category: "auth", status_code: 401,
        ip_hash: ipHash, user_agent: userAgent, audit_reference: requestId,
      });
      await emitAudit(svc, "registry_api_request_blocked", null, { request_id: requestId, reason: "auth" });
      return json(req, 401, buildResponseEnvelope({
        request_id: requestId, client_id: null, mode: requestedMode, scope: body.scope,
        endpoint: "profile-status", result_state: "api_client_not_allowed",
        country: body.country ?? null, company_reference: body.company_reference,
      }));
    }

    const decisions = evaluateApiGates({
      client_lifecycle_status: (auth.client.lifecycle_status ?? null) as never,
      client_mode: (auth.client.mode ?? "disabled") as RegistryApiMode,
      requested_mode: requestedMode,
      key_type: (auth.key.key_type ?? "sandbox") as never,
      key_status: (auth.key.status ?? null) as never,
      granted_scopes: auth.grantedScopes,
      requested_scope: body.scope,
      allowed_countries: auth.client.allowed_countries ?? [],
      requested_country: body.country ?? null,
      allowed_use_cases: auth.client.allowed_use_cases ?? [],
      requested_use_case: body.use_case ?? null,
      rate_limited: false,
    });

    const block = gatesToBlockedReason(decisions);
    if (block) {
      await logBlocked(svc, {
        request_id: requestId, client_id: auth.client.id, key_id: auth.key.id,
        endpoint: "profile-status", scope: body.scope, mode: requestedMode,
        country: body.country ?? null,
        block_reason: block.reason, block_category: block.result_state,
        status_code: 403, ip_hash: ipHash, user_agent: userAgent, audit_reference: requestId,
      });
      await emitAudit(svc, "registry_api_request_blocked", auth.client.id, { request_id: requestId, gate: block.result_state });
      return json(req, 403, buildResponseEnvelope({
        request_id: requestId, client_id: auth.client.id, mode: requestedMode, scope: body.scope,
        endpoint: "profile-status", result_state: block.result_state,
        country: body.country ?? null, company_reference: body.company_reference,
      }));
    }

    // Fetch company record by registration_number; gate on B14 controls.
    const { data: company } = await svc.from("registry_company_records")
      .select("id, country_code, lifecycle_state, readiness_state, claim_status, authority_status_label, archived_at, disabled_at, api_output_allowed")
      .eq("registration_number", body.company_reference).maybeSingle();

    let resultState: RegistryApiHardenedResultState = "not_found";
    if (company) {
      if (company.disabled_at) resultState = "disabled";
      else if (company.archived_at) resultState = "not_usable";
      else if ((company.readiness_state ?? "") === "seed") resultState = "seed_only";
      else if ((company.readiness_state ?? "") === "imported_unverified") resultState = "imported_unverified";
      else if ((company.lifecycle_state ?? "") === "shell") resultState = "not_ready";
      else if ((company.claim_status ?? "") !== "approved") resultState = "claim_not_enabled";
      else if ((company.authority_status_label ?? "") !== "approved") resultState = "authority_not_approved";
      else {
        const { data: bd } = await svc.from("business_decisions")
          .select("id").eq("category", "api_output").eq("status", "approved").limit(1).maybeSingle();
        if (!bd) resultState = "business_decision_required";
        else if (!company.api_output_allowed) resultState = "not_usable";
        else resultState = "usable";
      }
    }

    const envelope = buildResponseEnvelope({
      request_id: requestId, client_id: auth.client.id, mode: requestedMode, scope: body.scope,
      endpoint: "profile-status", result_state: resultState,
      country: body.country ?? company?.country_code ?? null,
      company_reference: body.company_reference,
      source_summary: null,
      readiness_summary: company?.readiness_state ?? null,
    });

    await logUsage(svc, {
      request_id: requestId, client_id: auth.client.id, key_id: auth.key.id,
      endpoint: "profile-status", scope: body.scope, mode: requestedMode,
      country: body.country ?? null, identifier_type: "company_reference",
      result_state: resultState, usable: envelope.usable, status_code: 200,
      ip_hash: ipHash, user_agent: userAgent, audit_reference: requestId,
    });
    await emitAudit(svc, "registry_api_request_allowed", auth.client.id, { request_id: requestId, result_state: resultState });
    await emitAudit(svc, "registry_api_profile_status_checked", auth.client.id, { request_id: requestId, result_state: resultState });

    return json(req, 200, envelope);
  } catch (err) {
    console.error("registry-api-profile-status error", err);
    return json(req, 500, { ok: false, request_id: requestId, error: "internal_error" });
  }
});
