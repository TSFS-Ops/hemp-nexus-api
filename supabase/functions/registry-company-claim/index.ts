// Batch 3 — M004 Claim Your Company workflow writer.
// Audited entry point for: start claim, submit claim, add evidence metadata,
// admin review (approve/reject/request_evidence/revoke).
// All status transitions flow through this function — the table trigger blocks
// direct status mutations from non-service_role callers.
//
// Canonical non-verification approval copy (pinned by
// scripts/check-registry-claim-approval-wording.mjs):
//   "Approving this claim confirms only that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details."
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_CLAIM_STATES,
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY,
  type RegistryClaimState,
} from "../_shared/registry-claims.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const StartSchema = z.object({
  action: z.literal("start"),
  company_reference: z.string().min(1).max(120),
  company_name: z.string().min(1).max(200),
  registration_number: z.string().max(60).optional(),
  country_code: z.string().min(2).max(8),
  claimant_name: z.string().min(1).max(120),
  claimant_email: z.string().email().max(200),
  claimant_role: z.string().min(1).max(120),
  company_relationship: z.string().min(1).max(120),
  company_email_domain: z.string().max(120).optional(),
});

const SubmitSchema = z.object({
  action: z.literal("submit"),
  claim_id: z.string().uuid(),
  declaration_of_authority: z.literal(true),
  consent_to_contact: z.literal(true),
  consent_to_process_evidence: z.literal(true),
});

const EvidenceSchema = z.object({
  action: z.literal("add_evidence"),
  claim_id: z.string().uuid(),
  evidence_kind: z.string().min(1).max(60),
  description: z.string().min(1).max(2000),
  external_reference: z.string().max(500).optional(),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const ReviewSchema = z.object({
  action: z.literal("review"),
  claim_id: z.string().uuid(),
  decision: z.enum(["approve", "reject", "request_evidence", "revoke"]),
  rationale: z.string().min(20).max(2000),
  acknowledged_not_verification: z.literal(true),
});

const BodySchema = z.discriminatedUnion("action", [
  StartSchema, SubmitSchema, EvidenceSchema, ReviewSchema,
]);

function decisionToState(decision: string): RegistryClaimState {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  if (decision === "revoke") return "revoked";
  return "evidence_required";
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    if (input.action === "start") {
      const { data: row, error } = await svc.from("registry_company_claims").insert({
        claimant_user_id: user.id,
        company_reference: input.company_reference,
        company_name: input.company_name,
        registration_number: input.registration_number ?? null,
        country_code: input.country_code,
        claimant_name: input.claimant_name,
        claimant_email: input.claimant_email,
        claimant_role: input.claimant_role,
        company_relationship: input.company_relationship,
        company_email_domain: input.company_email_domain ?? null,
        status: "claim_started",
      }).select("id").single();
      if (error) throw error;

      await svc.from("registry_company_claim_events").insert({
        claim_id: row.id,
        audit_event_name: "registry_company_claim_started",
        previous_status: "unclaimed",
        new_status: "claim_started",
        actor_id: user.id,
        payload: { company_reference: input.company_reference },
      });
      await svc.from("event_store").insert({
        event_name: "registry_company_claim_started",
        aggregate_id: row.id,
        aggregate_type: "registry_company_claim",
        actor_id: user.id,
        payload: { company_reference: input.company_reference },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true, claim_id: row.id, status: "claim_started" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "submit") {
      const { data: existing } = await svc.from("registry_company_claims").select("id, status, claimant_user_id").eq("id", input.claim_id).maybeSingle();
      if (!existing || existing.claimant_user_id !== user.id) {
        return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      if (existing.status !== "claim_started" && existing.status !== "evidence_required" && existing.status !== "evidence_submitted") {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: existing.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const previous = existing.status as RegistryClaimState;
      await svc.from("registry_company_claims").update({
        status: "claim_submitted",
        declaration_of_authority: true,
        consent_to_contact: true,
        consent_to_process_evidence: true,
        submitted_at: new Date().toISOString(),
      }).eq("id", input.claim_id);

      await svc.from("registry_company_claim_events").insert([
        { claim_id: input.claim_id, audit_event_name: "registry_company_claim_submitted", previous_status: previous, new_status: "claim_submitted", actor_id: user.id, payload: {} },
        { claim_id: input.claim_id, audit_event_name: "registry_company_claim_status_changed", previous_status: previous, new_status: "claim_submitted", actor_id: user.id, payload: {} },
      ]);
      await svc.from("event_store").insert({
        event_name: "registry_company_claim_submitted",
        aggregate_id: input.claim_id,
        aggregate_type: "registry_company_claim",
        actor_id: user.id,
        payload: { previous, next: "claim_submitted" },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true, claim_id: input.claim_id, status: "claim_submitted" satisfies RegistryClaimState }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "add_evidence") {
      const { data: existing } = await svc.from("registry_company_claims").select("id, status, claimant_user_id").eq("id", input.claim_id).maybeSingle();
      if (!existing || existing.claimant_user_id !== user.id) {
        return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_company_claim_evidence").insert({
        claim_id: input.claim_id,
        evidence_kind: input.evidence_kind,
        description: input.description,
        external_reference: input.external_reference ?? null,
        mime_type: input.mime_type ?? null,
        size_bytes: input.size_bytes ?? null,
        uploaded_by: user.id,
      });
      // If the claim was awaiting evidence, mark evidence_submitted.
      if (existing.status === "evidence_required") {
        await svc.from("registry_company_claims").update({ status: "evidence_submitted" }).eq("id", input.claim_id);
        await svc.from("registry_company_claim_events").insert({
          claim_id: input.claim_id,
          audit_event_name: "registry_company_claim_status_changed",
          previous_status: "evidence_required",
          new_status: "evidence_submitted",
          actor_id: user.id,
          payload: {},
        });
      }
      await svc.from("registry_company_claim_events").insert({
        claim_id: input.claim_id,
        audit_event_name: "registry_company_claim_evidence_added",
        previous_status: null,
        new_status: null,
        actor_id: user.id,
        payload: { evidence_kind: input.evidence_kind },
      });
      await svc.from("event_store").insert({
        event_name: "registry_company_claim_evidence_added",
        aggregate_id: input.claim_id,
        aggregate_type: "registry_company_claim",
        actor_id: user.id,
        payload: { evidence_kind: input.evidence_kind },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "review") {
      const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
      const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
      const isAuthorised = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
      if (!isAuthorised) {
        return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
      }
      const { data: existing } = await svc.from("registry_company_claims").select("id, status").eq("id", input.claim_id).maybeSingle();
      if (!existing) {
        return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      // Hard rule: cannot auto-approve from claim_started — must be at least submitted/under_review/evidence_submitted.
      if (input.decision === "approve" && !["claim_submitted", "under_review", "evidence_submitted"].includes(existing.status)) {
        return withCors(req, new Response(JSON.stringify({ error: "approval_not_allowed_from_state", current: existing.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const newStatus = decisionToState(input.decision);
      if (!REGISTRY_CLAIM_STATES.includes(newStatus)) {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_state" }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }

      await svc.from("registry_company_claim_reviews").insert({
        claim_id: input.claim_id,
        reviewer_id: user.id,
        decision: input.decision,
        rationale: input.rationale,
        acknowledged_not_verification: true,
      });
      await svc.from("registry_company_claims").update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewer_id: user.id,
      }).eq("id", input.claim_id);

      await svc.from("registry_company_claim_events").insert([
        { claim_id: input.claim_id, audit_event_name: "registry_company_claim_reviewed", previous_status: existing.status, new_status: newStatus, reason: input.rationale, actor_id: user.id, payload: { decision: input.decision } },
        { claim_id: input.claim_id, audit_event_name: "registry_company_claim_status_changed", previous_status: existing.status, new_status: newStatus, reason: input.rationale, actor_id: user.id, payload: { decision: input.decision } },
      ]);
      await svc.from("event_store").insert({
        event_name: "registry_company_claim_reviewed",
        aggregate_id: input.claim_id,
        aggregate_type: "registry_company_claim",
        actor_id: user.id,
        payload: { decision: input.decision, previous: existing.status, next: newStatus, non_verification_copy: REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true, claim_id: input.claim_id, status: newStatus, non_verification_copy: REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return withCors(req, new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-company-claim error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
