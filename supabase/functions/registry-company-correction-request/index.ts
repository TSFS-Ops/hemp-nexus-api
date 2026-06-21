// Batch 7 — Registry company correction request (Q11).
// Claimants may REQUEST corrections only. No direct edit of registry data.
// Public/API-visible fields do NOT change until an admin approves.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_CORRECTION_REQUEST_STATES,
  type RegistryCorrectionRequestState,
} from "../_shared/registry-claim-rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const StartSchema = z.object({
  action: z.literal("start"),
  claim_id: z.string().uuid().optional(),
  company_reference: z.string().min(1).max(120),
  field_path: z.string().min(1).max(120),
  current_value: z.string().max(2000).optional(),
  proposed_value: z.string().min(1).max(2000),
  rationale: z.string().min(20).max(2000),
  sensitive_field: z.boolean().optional(),
});
const EvidenceSchema = z.object({
  action: z.literal("add_evidence"),
  correction_id: z.string().uuid(),
  description: z.string().min(1).max(2000),
  external_reference: z.string().max(500).optional(),
});
const ReviewSchema = z.object({
  action: z.literal("review"),
  correction_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  rationale: z.string().min(20).max(2000),
  acknowledged_not_verification: z.literal(true),
});
const Body = z.discriminatedUnion("action", [StartSchema, EvidenceSchema, ReviewSchema]);

function decisionToState(d: string): RegistryCorrectionRequestState {
  return d === "approve" ? "approved" : "rejected";
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }
    if (!user.email_confirmed_at) {
      return withCors(req, new Response(JSON.stringify({ error: "email_verification_required" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    if (input.action === "start") {
      // Sensitive fields are auto-flagged for compliance review.
      const sensitive = Boolean(input.sensitive_field) ||
        /email|phone|address|bank|director|officer/i.test(input.field_path);
      const { data: row, error } = await svc.from("registry_company_correction_requests").insert({
        requester_user_id: user.id,
        claim_id: input.claim_id ?? null,
        company_reference: input.company_reference,
        status: "correction_requested",
        field_path: input.field_path,
        current_value: input.current_value ?? null,
        proposed_value: input.proposed_value,
        rationale: input.rationale,
        sensitive_field: sensitive,
      }).select("id").single();
      if (error) throw error;
      await svc.from("registry_company_correction_events").insert({
        correction_id: row.id, audit_event_name: "registry_company_correction_requested",
        new_status: "correction_requested", actor_id: user.id,
        payload: { field_path: input.field_path, sensitive_field: sensitive },
      });
      await svc.from("event_store").insert({
        event_name: "registry_company_correction_requested",
        aggregate_id: row.id, aggregate_type: "registry_company_correction_request",
        actor_id: user.id, payload: { field_path: input.field_path },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, correction_id: row.id, status: "correction_requested" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "add_evidence") {
      const { data: existing } = await svc.from("registry_company_correction_requests")
        .select("id, requester_user_id").eq("id", input.correction_id).maybeSingle();
      if (!existing || existing.requester_user_id !== user.id) {
        return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_company_correction_events").insert({
        correction_id: input.correction_id,
        audit_event_name: "registry_company_correction_evidence_added",
        actor_id: user.id,
        payload: { description: input.description, external_reference: input.external_reference ?? null },
      });
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // review
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const { data: existing } = await svc.from("registry_company_correction_requests")
      .select("id, status, field_path, sensitive_field").eq("id", input.correction_id).maybeSingle();
    if (!existing) {
      return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    }
    if (!["correction_requested", "evidence_required", "under_admin_review"].includes(existing.status)) {
      return withCors(req, new Response(JSON.stringify({ error: "approval_not_allowed_from_state", current: existing.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }
    if (existing.sensitive_field && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "sensitive_field_requires_compliance_owner" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const next = decisionToState(input.decision);
    if (!REGISTRY_CORRECTION_REQUEST_STATES.includes(next as RegistryCorrectionRequestState)) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_state" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    await svc.from("registry_company_correction_requests").update({
      status: next, reviewer_id: user.id, reviewed_at: new Date().toISOString(),
      decision_reason: input.rationale,
    }).eq("id", input.correction_id);

    await svc.from("registry_company_correction_events").insert([
      { correction_id: input.correction_id, audit_event_name: "registry_company_correction_reviewed",
        previous_status: existing.status, new_status: next, actor_id: user.id, reason: input.rationale, payload: { decision: input.decision } },
    ]);
    if (input.decision === "approve") {
      // The "apply" step intentionally records an audit event ONLY. Actual
      // public/API field mutation is deferred to a separate provenance writer
      // that creates a new provenance record (Q11).
      await svc.from("registry_company_correction_events").insert({
        correction_id: input.correction_id,
        audit_event_name: "registry_company_correction_applied",
        previous_status: next, new_status: "profile_updated_with_new_provenance",
        actor_id: user.id, payload: { field_path: existing.field_path },
      });
      await svc.from("registry_company_correction_requests").update({
        status: "profile_updated_with_new_provenance",
        applied_at: new Date().toISOString(),
      }).eq("id", input.correction_id);
    }

    return withCors(req, new Response(JSON.stringify({ ok: true, status: next }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: String((e as Error).message ?? e) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
