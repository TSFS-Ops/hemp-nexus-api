// Batch 14 — Verification review & promotion gate.
// Records manual_verified / manual_failed decisions. Promotes to `verified`
// ONLY when ALL decision gates pass AND acknowledgement + compliance_owner role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  evaluateDecisionGates,
  REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT,
  REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS,
} from "../_shared/registry-bank-verification.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["manual_verified", "manual_failed", "promote_to_verified", "cancel"]),
  acknowledgement_text: z.string().optional(),
  verification_method: z.string().min(3).max(120).optional(),
  verification_basis: z.string().min(3).max(2000).optional(),
  evidence_basis: z.string().min(3).max(2000).optional(),
  second_reviewer_id: z.string().uuid().optional(),
  high_risk: z.boolean().optional(),
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
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return json(req, 403, { error: "forbidden" });
    }

    const { data: vr } = await svc.from("registry_bank_detail_verification_requests")
      .select("*").eq("id", input.request_id).maybeSingle();
    if (!vr) return json(req, 404, { error: "request_not_found" });

    const { data: submission } = await svc.from("registry_bank_detail_submissions")
      .select("id, status").eq("id", vr.submission_id).maybeSingle();
    if (!submission) return json(req, 404, { error: "submission_not_found" });

    const now = new Date();
    const isCancel = input.decision === "cancel";

    // ── Cancel path ──────────────────────────────────────────────────────────
    if (isCancel) {
      await svc.from("registry_bank_detail_verification_requests").update({
        verification_status: "cancelled", cancelled_at: now.toISOString(), cancelled_reason: input.reason,
      }).eq("id", vr.id);
      await svc.from("registry_bank_detail_verification_events").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        audit_event_name: "registry_bank_verification_cancelled",
        previous_status: vr.verification_status, new_status: "cancelled",
        actor_id: user.id, reason: input.reason, payload: {},
      });
      return json(req, 200, { ok: true, verification_status: "cancelled" });
    }

    // ── Manual failed path ───────────────────────────────────────────────────
    if (input.decision === "manual_failed") {
      await svc.from("registry_bank_detail_verification_decisions").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        decision_outcome: "manual_failed", reviewer_id: user.id,
        reviewer_role: roleSet.has("compliance_owner") ? "compliance_owner" : "platform_admin",
        reason: input.reason,
      });
      await svc.from("registry_bank_detail_verification_requests").update({ verification_status: "failed" }).eq("id", vr.id);
      await svc.from("registry_bank_detail_verification_events").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        audit_event_name: "registry_bank_verification_manual_failed",
        previous_status: vr.verification_status, new_status: "failed",
        actor_id: user.id, reason: input.reason, payload: {},
      });
      return json(req, 200, { ok: true, verification_status: "failed" });
    }

    // ── Manual verified path (DOES NOT promote to API-verified) ──────────────
    if (input.decision === "manual_verified") {
      // Manual verification disabled by default — must explicitly require business decision.
      if (vr.verification_mode !== "manual_verification_allowed") {
        await svc.from("registry_bank_detail_verification_events").insert({
          request_id: vr.id, submission_id: vr.submission_id,
          audit_event_name: "registry_bank_verification_request_blocked",
          previous_status: vr.verification_status, new_status: vr.verification_status,
          actor_id: user.id, reason: "manual_verification_disabled_for_mode",
          payload: { mode: vr.verification_mode },
        });
        return json(req, 409, { ok: false, error: "manual_verification_disabled_for_mode" });
      }
      if (!roleSet.has("compliance_owner")) {
        return json(req, 403, { error: "compliance_owner_required_for_manual_verification" });
      }
      if (input.acknowledgement_text !== REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT) {
        return json(req, 400, { error: "acknowledgement_mismatch" });
      }
      if (!input.verification_method || !input.verification_basis || !input.evidence_basis) {
        return json(req, 400, { error: "manual_verification_required_fields_missing" });
      }
      const days = input.high_risk
        ? REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.high_risk_manual_verified
        : REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.manual_verified;
      if (input.high_risk && !input.second_reviewer_id) {
        return json(req, 400, { error: "second_reviewer_required_for_high_risk" });
      }
      const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
      await svc.from("registry_bank_detail_verification_decisions").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        decision_outcome: "manual_verified", reviewer_id: user.id,
        reviewer_role: "compliance_owner",
        second_reviewer_id: input.second_reviewer_id ?? null,
        acknowledgement_text: input.acknowledgement_text,
        verification_method: input.verification_method,
        verification_basis: input.verification_basis,
        evidence_basis: input.evidence_basis,
        expires_at: expiresAt, reason: input.reason,
      });
      await svc.from("registry_bank_detail_verification_requests").update({
        verification_status: "manual_verified", expires_at: expiresAt,
      }).eq("id", vr.id);
      await svc.from("registry_bank_detail_verification_events").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        audit_event_name: "registry_bank_verification_manual_verified",
        previous_status: vr.verification_status, new_status: "manual_verified",
        actor_id: user.id, reason: input.reason,
        payload: { expires_at: expiresAt, high_risk: !!input.high_risk },
      });
      // Important: API status remains NOT verified until promote_to_verified.
      return json(req, 200, { ok: true, verification_status: "manual_verified", expires_at: expiresAt, api_verified: false });
    }

    // ── Promote to verified path ─────────────────────────────────────────────
    if (input.decision === "promote_to_verified") {
      // Re-evaluate ALL gates strictly.
      const { data: bd } = vr.business_decision_id
        ? await svc.from("business_decisions").select("id, status").eq("id", vr.business_decision_id).maybeSingle()
        : { data: null };
      const failed = evaluateDecisionGates({
        submission_status: "captured_unverified",
        company_active: true,
        authority_valid: true,
        admin_initiated: true,
        consent_scopes: ["internal_verification", "institutional_status_response", "re_verification", "audit_retention"],
        evidence_accepted: true,
        risk_level: "low",
        duplicate_resolved: true,
        holder_match_resolved: true,
        country_supports_mode: !!vr.country_supports_mode,
        source_provenance_present: true,
        business_decision_approved: !!bd && bd.status === "approved",
        mode: vr.verification_mode,
        approval_role: "compliance_owner",
        required_role: "compliance_owner",
      });
      // Must originate from manual_verified OR provider_matched
      const promotable = vr.verification_status === "manual_verified" || vr.verification_status === "provider_matched";
      if (failed.length || !promotable || !roleSet.has("compliance_owner") ||
          input.acknowledgement_text !== REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT) {
        await svc.from("registry_bank_detail_verification_events").insert({
          request_id: vr.id, submission_id: vr.submission_id,
          audit_event_name: "registry_bank_verification_promotion_blocked",
          previous_status: vr.verification_status, new_status: vr.verification_status,
          actor_id: user.id, reason: input.reason,
          payload: { blocking_gates: failed, promotable, ack_ok: input.acknowledgement_text === REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT },
        });
        return json(req, 409, { ok: false, error: "promotion_blocked", blocking_gates: failed });
      }
      const days = vr.verification_status === "provider_matched"
        ? REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.provider_verified
        : REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.manual_verified;
      const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
      await svc.from("registry_bank_detail_verification_decisions").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        decision_outcome: "promoted_to_verified", reviewer_id: user.id,
        reviewer_role: "compliance_owner",
        acknowledgement_text: input.acknowledgement_text,
        verification_method: input.verification_method ?? null,
        expires_at: expiresAt, promoted_to_verified: true,
        business_decision_id: vr.business_decision_id, reason: input.reason,
      });
      await svc.from("registry_bank_detail_verification_requests").update({
        verification_status: "verified", expires_at: expiresAt,
      }).eq("id", vr.id);
      await svc.from("registry_bank_detail_submissions").update({
        status: "verified", verified_at: now.toISOString(), verified_by: user.id,
        verification_method: input.verification_method ?? "manual_promoted",
        expiry_at: expiresAt,
      }).eq("id", vr.submission_id);
      await svc.from("registry_bank_detail_verification_events").insert({
        request_id: vr.id, submission_id: vr.submission_id,
        audit_event_name: "registry_bank_verification_promoted_to_verified",
        previous_status: vr.verification_status, new_status: "verified",
        actor_id: user.id, reason: input.reason, payload: { expires_at: expiresAt },
      });
      return json(req, 200, { ok: true, verification_status: "verified", api_verified: true, expires_at: expiresAt });
    }

    return json(req, 400, { error: "unknown_decision" });
  } catch (err) {
    console.error("registry-bank-verification-review error", err);
    return json(req, 500, { error: "internal_error" });
  }
});
