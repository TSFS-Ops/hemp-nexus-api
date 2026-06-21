// Batch 7 — Registry new-company request (Q10).
// Users may submit a request when no company is found. Records are NEVER
// created as public. Provisional records require admin review and labelling.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_NEW_COMPANY_REQUEST_STATES,
  REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY,
  type RegistryNewCompanyRequestState,
} from "../_shared/registry-claim-rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const StartSchema = z.object({
  action: z.literal("start"),
  company_name: z.string().min(1).max(200),
  country_code: z.string().min(2).max(8),
  registration_number: z.string().max(60).optional(),
  legal_form: z.string().max(60).optional(),
  source_or_evidence: z.string().max(2000).optional(),
  claimant_name: z.string().min(1).max(120),
  claimant_email: z.string().email().max(200),
  reason_for_adding: z.string().min(10).max(2000),
});
const SubmitSchema = z.object({
  action: z.literal("submit"),
  request_id: z.string().uuid(),
});
const ReviewSchema = z.object({
  action: z.literal("review"),
  request_id: z.string().uuid(),
  decision: z.enum(["approve_provisional", "reject"]),
  rationale: z.string().min(20).max(2000),
  acknowledged_not_verification: z.literal(true),
});
const Body = z.discriminatedUnion("action", [StartSchema, SubmitSchema, ReviewSchema]);

function decisionToState(d: string): RegistryNewCompanyRequestState {
  if (d === "approve_provisional") return "provisional_record_created";
  return "request_rejected";
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
      // Duplicate-check pre-flight: simple name+country candidate scan (no PII leak).
      const { data: candidates } = await svc
        .from("registry_company_claims")
        .select("id, company_name, country_code")
        .ilike("company_name", input.company_name)
        .eq("country_code", input.country_code)
        .limit(5);
      const candidateIds = (candidates ?? []).map((c: { id: string }) => c.id);

      const { data: row, error } = await svc
        .from("registry_new_company_requests")
        .insert({
          requester_user_id: user.id,
          status: "new_company_request_started",
          company_name: input.company_name,
          country_code: input.country_code,
          registration_number: input.registration_number ?? null,
          legal_form: input.legal_form ?? null,
          source_or_evidence: input.source_or_evidence ?? null,
          claimant_name: input.claimant_name,
          claimant_email: input.claimant_email,
          reason_for_adding: input.reason_for_adding,
          duplicate_candidate_ids: candidateIds,
        })
        .select("id")
        .single();
      if (error) throw error;

      await svc.from("registry_new_company_request_events").insert([
        { request_id: row.id, audit_event_name: "registry_new_company_request_started", new_status: "new_company_request_started", actor_id: user.id, payload: { company_name: input.company_name } },
        { request_id: row.id, audit_event_name: "registry_new_company_duplicate_check_started", actor_id: user.id, payload: { candidates: candidateIds.length } },
      ]);
      await svc.from("event_store").insert({
        event_name: "registry_new_company_request_started",
        aggregate_id: row.id, aggregate_type: "registry_new_company_request",
        actor_id: user.id, payload: { country: input.country_code },
      }).catch(() => {});

      return withCors(req, new Response(JSON.stringify({ ok: true, request_id: row.id, duplicate_candidate_count: candidateIds.length, status: "new_company_request_started" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "submit") {
      const { data: existing } = await svc.from("registry_new_company_requests").select("id, status, requester_user_id").eq("id", input.request_id).maybeSingle();
      if (!existing || existing.requester_user_id !== user.id) {
        return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      if (!["new_company_request_started", "basic_details_submitted", "source_evidence_required"].includes(existing.status)) {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: existing.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const next: RegistryNewCompanyRequestState = "admin_review";
      await svc.from("registry_new_company_requests").update({ status: next }).eq("id", input.request_id);
      await svc.from("registry_new_company_request_events").insert({
        request_id: input.request_id, audit_event_name: "registry_new_company_request_submitted",
        previous_status: existing.status, new_status: next, actor_id: user.id,
      });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: next }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // review
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const { data: existing } = await svc.from("registry_new_company_requests").select("id, status").eq("id", input.request_id).maybeSingle();
    if (!existing) {
      return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    }
    if (existing.status !== "admin_review" && existing.status !== "duplicate_check_pending") {
      return withCors(req, new Response(JSON.stringify({ error: "approval_not_allowed_from_state", current: existing.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }
    const next = decisionToState(input.decision);
    if (!REGISTRY_NEW_COMPANY_REQUEST_STATES.includes(next as RegistryNewCompanyRequestState)) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_state" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    await svc.from("registry_new_company_requests").update({
      status: next, reviewer_id: user.id, reviewed_at: new Date().toISOString(),
      rejection_reason: input.decision === "reject" ? input.rationale : null,
    }).eq("id", input.request_id);

    const eventName = input.decision === "approve_provisional"
      ? "registry_new_company_provisional_created"
      : "registry_new_company_request_rejected";
    await svc.from("registry_new_company_request_events").insert({
      request_id: input.request_id, audit_event_name: eventName,
      previous_status: existing.status, new_status: next, actor_id: user.id, reason: input.rationale,
      payload: { non_verification_copy: REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY },
    });

    return withCors(req, new Response(JSON.stringify({ ok: true, status: next, label: REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: String((e as Error).message ?? e) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
