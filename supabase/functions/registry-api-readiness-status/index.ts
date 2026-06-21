// Batch 15 — registry-api-readiness-status. Safe readiness summary only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { hashApiKey } from "../_shared/registry-institutional-api.ts";
import {
  buildResponseEnvelope, evaluateApiGates, gatesToBlockedReason,
  REGISTRY_API_DEFAULT_MODE, type RegistryApiMode, type RegistryApiHardenedResultState,
} from "../_shared/registry-api-hardening.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BodySchema = z.object({
  company_reference: z.string().min(1).max(120),
  country: z.string().length(2).optional(),
  use_case: z.string().optional(),
  scope: z.string().default("registry.readiness.read"),
  mode: z.string().default(REGISTRY_API_DEFAULT_MODE),
});

function json(req: Request, s: number, b: unknown) {
  return withCors(req, new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req); if (pre) return pre;
  const requestId = crypto.randomUUID();
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { ok: false, request_id: requestId, error: "invalid_body" });
    const body = parsed.data;
    const mode = body.mode as RegistryApiMode;

    const apiKey = req.headers.get("x-api-key") ?? "";
    const prefix = apiKey.split("_").slice(0, 3).join("_");
    const expectedHash = apiKey ? await hashApiKey(apiKey) : "";
    const { data: key } = await svc.from("registry_api_keys")
      .select("id, client_id, status, key_hash, key_type")
      .eq("key_prefix", prefix).eq("status", "active").maybeSingle();
    if (!key || key.key_hash !== expectedHash) {
      return json(req, 401, buildResponseEnvelope({
        request_id: requestId, client_id: null, mode, scope: body.scope, endpoint: "readiness-status",
        result_state: "api_client_not_allowed", company_reference: body.company_reference,
      }));
    }
    const { data: client } = await svc.from("registry_api_clients")
      .select("id, lifecycle_status, mode, allowed_countries, allowed_use_cases, scopes")
      .eq("id", key.client_id).maybeSingle();
    const { data: scopeRows } = await svc.from("registry_api_client_scopes")
      .select("scope_key").eq("client_id", client!.id).is("revoked_at", null);
    const granted = (scopeRows ?? []).map((r: { scope_key: string }) => r.scope_key).concat(client!.scopes ?? []);

    const decisions = evaluateApiGates({
      client_lifecycle_status: (client!.lifecycle_status ?? null) as never,
      client_mode: (client!.mode ?? "disabled") as RegistryApiMode,
      requested_mode: mode,
      key_type: (key.key_type ?? "sandbox") as never,
      key_status: key.status as never,
      granted_scopes: granted,
      requested_scope: body.scope,
      allowed_countries: client!.allowed_countries ?? [],
      requested_country: body.country ?? null,
      allowed_use_cases: client!.allowed_use_cases ?? [],
      requested_use_case: body.use_case ?? null,
      rate_limited: false,
    });
    const block = gatesToBlockedReason(decisions);
    if (block) {
      await svc.from("registry_api_blocked_events").insert({
        request_id: requestId, client_id: client!.id, key_id: key.id, endpoint: "readiness-status",
        scope: body.scope, mode, block_reason: block.reason, block_category: block.result_state,
        status_code: 403, audit_reference: requestId,
      }).catch(() => {});
      await svc.from("registry_api_audit_events").insert({
        audit_event_name: "registry_api_request_blocked", client_id: client!.id, payload: { request_id: requestId },
      }).catch(() => {});
      return json(req, 403, buildResponseEnvelope({
        request_id: requestId, client_id: client!.id, mode, scope: body.scope, endpoint: "readiness-status",
        result_state: block.result_state, company_reference: body.company_reference,
      }));
    }

    const { data: r } = await svc.from("registry_company_records")
      .select("readiness_state").eq("registration_number", body.company_reference).maybeSingle();
    const state: RegistryApiHardenedResultState = !r ? "not_found"
      : r.readiness_state === "ready" ? "usable"
      : r.readiness_state === "seed" ? "seed_only"
      : r.readiness_state === "imported_unverified" ? "imported_unverified"
      : "not_ready";

    const env = buildResponseEnvelope({
      request_id: requestId, client_id: client!.id, mode, scope: body.scope, endpoint: "readiness-status",
      result_state: state, company_reference: body.company_reference, readiness_summary: r?.readiness_state ?? null,
    });
    await svc.from("registry_api_usage_events").insert({
      request_id: requestId, client_id: client!.id, key_id: key.id, endpoint: "readiness-status",
      scope: body.scope, mode, result_state: state, usable: env.usable, status_code: 200, audit_reference: requestId,
    }).catch(() => {});
    await svc.from("registry_api_audit_events").insert({
      audit_event_name: "registry_api_request_allowed", client_id: client!.id, payload: { request_id: requestId },
    }).catch(() => {});
    return json(req, 200, env);
  } catch (e) {
    console.error("readiness-status error", e);
    return json(req, 500, { ok: false, request_id: requestId, error: "internal_error" });
  }
});
