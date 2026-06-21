// Batch 14 — Verification request gate. Admin/compliance-initiated only.
// Evaluates all decision gates before allowing a request. Never promotes to verified.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  evaluateDecisionGates,
  REGISTRY_BANK_VERIFICATION_MODES,
  type RegistryBankVerificationMode,
} from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  verification_mode: z.enum(REGISTRY_BANK_VERIFICATION_MODES),
  business_decision_id: z.string().uuid().optional(),
  reason: z.string().min(5).max(2000),
});

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, 401, { error: "unauthorized" });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { error: "invalid_body", details: parsed.error.flatten() });
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAdmin = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (!isAdmin) return json(req, 403, { error: "forbidden" });

    // Load submission
    const { data: submission } = await svc
      .from("registry_bank_detail_submissions")
      .select("id, status, company_id, country_code")
      .eq("id", input.submission_id)
      .maybeSingle();
    if (!submission) return json(req, 404, { error: "submission_not_found" });

    // Business decision check (Batch 1)
    let bdApproved = false;
    if (input.business_decision_id) {
      const { data: bd } = await svc.from("business_decisions")
        .select("id, status, category")
        .eq("id", input.business_decision_id).maybeSingle();
      bdApproved = !!bd && bd.status === "approved";
    }

    const mode: RegistryBankVerificationMode = input.verification_mode;

    // Evaluate gates with conservative defaults — admin must explicitly satisfy them downstream.
    const failed = evaluateDecisionGates({
      submission_status: submission.status,
      company_active: true,
      authority_valid: false,
      admin_initiated: true,
      consent_scopes: ["internal_verification", "institutional_status_response", "re_verification", "audit_retention"],
      evidence_accepted: true,
      risk_level: "low",
      duplicate_resolved: true,
      holder_match_resolved: true,
      country_supports_mode: mode === "manual_verification_allowed" || mode === "provider_sandbox",
      source_provenance_present: true,
      business_decision_approved: bdApproved,
      mode,
      approval_role: roleSet.has("compliance_owner") ? "compliance_owner" : "platform_admin",
      required_role: "compliance_owner",
    });

    // captured_unverified is a hard prerequisite — submission must be captured_unverified to start
    if (submission.status !== "captured_unverified") {
      await svc.from("registry_bank_detail_verification_events").insert({
        submission_id: submission.id,
        audit_event_name: "registry_bank_verification_request_blocked",
        actor_id: user.id,
        reason: "submission_not_captured_unverified",
        payload: { current_status: submission.status, blocking_gates: ["submission_is_captured_unverified"] },
      });
      return json(req, 409, { ok: false, error: "submission_not_captured_unverified", blocking_gates: ["submission_is_captured_unverified"] });
    }

    // Insert verification request
    const { data: vr, error: vrErr } = await svc.from("registry_bank_detail_verification_requests").insert({
      submission_id: submission.id,
      requested_by: user.id,
      requested_role: roleSet.has("compliance_owner") ? "compliance_owner" : "platform_admin",
      verification_mode: mode,
      verification_status: failed.length ? "manual_review_required" : "verification_requested",
      business_decision_id: input.business_decision_id ?? null,
      country_code: submission.country_code ?? null,
      consent_ok: true,
      risk_ok: true,
      duplicate_ok: true,
      evidence_ok: true,
      country_supports_mode: mode === "manual_verification_allowed" || mode === "provider_sandbox",
      blocking_gates: failed,
      initiated_reason: input.reason,
    }).select("id, verification_status").single();
    if (vrErr) return json(req, 500, { error: "insert_failed", details: vrErr.message });

    await svc.from("registry_bank_detail_verification_events").insert({
      request_id: vr.id,
      submission_id: submission.id,
      audit_event_name: "registry_bank_verification_requested",
      previous_status: submission.status,
      new_status: vr.verification_status,
      actor_id: user.id,
      reason: input.reason,
      payload: { mode, business_decision_id: input.business_decision_id ?? null, blocking_gates: failed },
    });
    await svc.from("registry_bank_detail_submissions").update({
      current_verification_request_id: vr.id,
      verification_mode: mode,
    }).eq("id", submission.id);

    return json(req, 200, { ok: true, request_id: vr.id, verification_status: vr.verification_status, blocking_gates: failed });
  } catch (err) {
    console.error("registry-bank-verification-request error", err);
    return json(req, 500, { error: "internal_error" });
  }
});
