// Batch 5 — M009 Institutional Payment-Detail Status API facade.
// Returns SAFE STATUS ONLY. Raw bank details are NEVER returned. Maps the
// underlying bank-detail state to the canonical payment-status flag and
// consults the Business Decision Register before declaring institutionally
// usable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_API_RESULT_EXPLANATIONS,
  REGISTRY_API_SCOPES,
  hashApiKey,
  mapBankStateToApiFlag,
  type RegistryApiResultState,
} from "../_shared/registry-institutional-api.ts";
import { maskAccountToken } from "../_shared/registry-bank-details.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  company_reference: z.string().min(1).max(120),
  scope: z.enum(REGISTRY_API_SCOPES).default("registry.payment_status.read"),
});

async function authenticate(svc: ReturnType<typeof createClient>, req: Request) {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey || !apiKey.startsWith("rk_")) return null;
  const prefix = apiKey.split("_").slice(0, 3).join("_");
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
  return { client_id: data.client_id, key_id: data.id, environment: data.environment, scopes: client.scopes ?? [] };
}

async function audit(svc: ReturnType<typeof createClient>, name: string, payload: Record<string, unknown>, clientId: string | null, keyId: string | null) {
  await svc.from("registry_api_audit_events").insert({ audit_event_name: name, client_id: clientId, key_id: keyId, payload }).catch(() => {});
  await svc.from("event_store").insert({ event_name: name, aggregate_type: "registry_api", payload }).catch(() => {});
}

async function logRequest(svc: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  await svc.from("registry_api_request_logs").insert(row).catch(() => {});
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

    if (!auth.scopes.includes(scope)) {
      await audit(svc, "registry_api_scope_denied", { scope, request_id: requestId }, auth.client_id, auth.key_id);
      await logRequest(svc, {
        client_id: auth.client_id, key_id: auth.key_id, environment: auth.environment,
        endpoint: "registry-institutional-payment-status", scope_requested: scope, scope_granted: false,
        result_state: "not_usable", status_code: 403, request_id: requestId,
      });
      return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, result_state: "not_usable", safe_explanation: "Scope not granted to this client." }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    await audit(svc, "registry_api_payment_status_requested", { company_reference, scope, request_id: requestId }, auth.client_id, auth.key_id);

    // Look up the latest bank-detail submission for this company reference.
    // Records may not exist (Batch 5 has no production data) — degrade safely.
    const { data: submission } = await svc
      .from("registry_bank_detail_submissions")
      .select("id, status, verification_method, verified_at, expiry_at, masked_account_reference, dispute_reason, revocation_reason, expires_at")
      .eq("company_reference", company_reference)
      .order("created_at", { ascending: false })
      .maybeSingle();

    // Consult Business Decision Register before any "usable" can be returned.
    const { data: decisions } = await svc
      .from("business_decisions")
      .select("id, scope_key")
      .eq("category", "api_output")
      .eq("status", "approved")
      .limit(50);
    const bdApproved = !!(decisions ?? []).find((d: { scope_key: string | null }) =>
      d.scope_key === company_reference || d.scope_key === "*"
    );

    let result_state: RegistryApiResultState = "not_found";
    const bankState = submission?.status ?? "not_provided";
    const paymentFlag = mapBankStateToApiFlag(bankState);

    // Batch 14 safety patch — B14 verification status is the authoritative
    // source of truth when a verification request exists for this submission.
    let b14Status: string | null = null;
    let b14ExpiresAt: string | null = null;
    if (submission?.id) {
      const { data: vr } = await svc
        .from("registry_bank_detail_verification_requests")
        .select("verification_status, expires_at")
        .eq("submission_id", submission.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (vr) {
        b14Status = vr.verification_status as string;
        b14ExpiresAt = vr.expires_at ?? null;
      }
    }
    const b14ExpiredNow = b14Status === "verified" && b14ExpiresAt && new Date(b14ExpiresAt) < new Date();
    // Any non-`verified` B14 status, or expired verified, demotes to not_usable.
    const b14DemotesToNotUsable = b14Status !== null && (b14Status !== "verified" || b14ExpiredNow);

    if (!submission) {
      result_state = "not_found";
    } else if (!bdApproved) {
      result_state = "business_decision_required";
    } else if (b14DemotesToNotUsable) {
      if (b14Status === "expired" || b14ExpiredNow) result_state = "expired";
      else if (b14Status === "disputed") result_state = "disputed";
      else if (b14Status === "revoked") result_state = "revoked";
      else result_state = "not_usable";
    } else if (paymentFlag === "verified") {
      // Verified requires non-null method, verified_at, expiry_at AND a Business
      // Decision. Anything missing degrades to not_usable.
      if (submission.verification_method && submission.verified_at && (submission.expires_at || submission.expiry_at)) {
        result_state = "usable";
      } else {
        result_state = "not_usable";
      }
    } else if (paymentFlag === "expired") {
      result_state = "expired";
    } else if (paymentFlag === "disputed") {
      result_state = "disputed";
    } else if (bankState === "revoked") {
      result_state = "revoked";
    } else {
      result_state = "not_usable";
    }

    const body = {
      ok: true,
      request_id: requestId,
      api_client_id: auth.client_id,
      company_reference,
      payment_detail_status: paymentFlag,
      bank_detail_verification_status: bankState,
      masked_reference: scope === "registry.payment_status.read" && submission?.masked_account_reference
        ? maskAccountToken(submission.masked_account_reference) : null,
      verification_method: submission?.verification_method ?? null,
      verified_at: submission?.verified_at ?? null,
      expiry_at: submission?.expiry_at ?? submission?.expires_at ?? null,
      revoked_reason: submission?.revocation_reason ?? null,
      disputed_reason: submission?.dispute_reason ?? null,
      confidence_level: paymentFlag === "verified" ? "high" : "none",
      result_state,
      safe_explanation: REGISTRY_API_RESULT_EXPLANATIONS[result_state],
      audit_reference: requestId,
    };

    await logRequest(svc, {
      client_id: auth.client_id, key_id: auth.key_id, environment: auth.environment,
      endpoint: "registry-institutional-payment-status", scope_requested: scope, scope_granted: true,
      result_state, status_code: 200, request_id: requestId,
      payload_summary: { company_reference },
    });
    await audit(svc, "registry_api_response_returned", { endpoint: "registry-institutional-payment-status", result_state, request_id: requestId }, auth.client_id, auth.key_id);

    return withCors(req, new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-institutional-payment-status error", err);
    return withCors(req, new Response(JSON.stringify({ ok: false, request_id: requestId, error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
