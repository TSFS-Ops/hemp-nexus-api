// Batch 14 — API payment-status (B14 controlled view).
// Reads B14 verification status, returns SAFE STATUS ONLY. No raw bank fields.
// Returns "verified" only for FINAL unexpired verified status; everything else is not_verified.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  hashApiKey,
  REGISTRY_API_SCOPES,
} from "../_shared/registry-institutional-api.ts";
import {
  mapVerificationStatusToApiFlag,
  REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS,
  type RegistryBankVerificationStatus,
} from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  company_reference: z.string().min(1).max(120),
  scope: z.enum(REGISTRY_API_SCOPES).default("registry.payment_status.read"),
});

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function authenticate(svc: ReturnType<typeof createClient>, req: Request) {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey || !apiKey.startsWith("rk_")) return null;
  const prefix = apiKey.split("_").slice(0, 3).join("_");
  const expectedHash = await hashApiKey(apiKey);
  const { data } = await svc.from("registry_api_keys")
    .select("id, client_id, environment, status, key_hash")
    .eq("key_prefix", prefix).eq("status", "active").maybeSingle();
  if (!data || data.key_hash !== expectedHash) return null;
  const { data: client } = await svc.from("registry_api_clients")
    .select("scopes, status").eq("id", data.client_id).maybeSingle();
  if (!client || client.status !== "active") return null;
  return { client_id: data.client_id, key_id: data.id, environment: data.environment, scopes: client.scopes ?? [] };
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  const requestId = crypto.randomUUID();
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const auth = await authenticate(svc, req);
    if (!auth) return json(req, 401, { ok: false, request_id: requestId, payment_detail_status: "not_verified", safe_explanation: "Authentication failed." });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { ok: false, request_id: requestId, error: "invalid_body" });
    const { company_reference, scope } = parsed.data;

    if (!auth.scopes.includes(scope)) {
      return json(req, 403, { ok: false, request_id: requestId, payment_detail_status: "not_verified", safe_explanation: "Scope not granted to this client." });
    }

    // Latest submission for this company
    const { data: submission } = await svc.from("registry_bank_detail_submissions")
      .select("id, status, company_id, country_code")
      .eq("company_reference", company_reference)
      .order("created_at", { ascending: false }).maybeSingle();

    let verificationStatus: RegistryBankVerificationStatus = "not_started";
    let expiresAt: string | null = null;

    if (submission) {
      // Read the latest B14 verification request — that is the source of truth.
      const { data: vr } = await svc.from("registry_bank_detail_verification_requests")
        .select("verification_status, expires_at")
        .eq("submission_id", submission.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (vr) {
        verificationStatus = vr.verification_status as RegistryBankVerificationStatus;
        expiresAt = vr.expires_at ?? null;
      } else {
        // No B14 request — fall back to submission state, but ALWAYS not verified.
        verificationStatus = submission.status === "verified" ? "captured_unverified" : (submission.status as RegistryBankVerificationStatus);
      }
    }

    // Expiry enforcement
    const now = new Date();
    if (verificationStatus === "verified" && expiresAt && new Date(expiresAt) < now) {
      verificationStatus = "expired";
    }

    // Business decision gate for API output
    const { data: decisions } = await svc.from("business_decisions")
      .select("id, scope_key").eq("category", "api_output").eq("status", "approved").limit(50);
    const bdApproved = !!(decisions ?? []).find((d: { scope_key: string | null }) =>
      d.scope_key === company_reference || d.scope_key === "*");

    let apiFlag = mapVerificationStatusToApiFlag(verificationStatus);
    if (apiFlag === "verified" && !bdApproved) apiFlag = "not_verified";

    await svc.from("registry_bank_detail_verification_events").insert({
      submission_id: submission?.id ?? null,
      audit_event_name: "registry_bank_verification_api_status_checked",
      actor_id: null, reason: "api_payment_status",
      payload: { company_reference, api_flag: apiFlag, verification_status: verificationStatus, request_id: requestId, client_id: auth.client_id },
    }).catch(() => {});

    return json(req, 200, {
      ok: true,
      request_id: requestId,
      company_reference,
      payment_detail_status: apiFlag,
      verification_status: verificationStatus,
      safe_label: REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS[verificationStatus],
      // No raw or masked bank fields returned in Batch 14.
      audit_reference: requestId,
    });
  } catch (err) {
    console.error("registry-bank-verification-api-status error", err);
    return json(req, 500, { ok: false, request_id: requestId, error: "internal_error" });
  }
});
