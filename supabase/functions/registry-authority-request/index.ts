// Batch 4 — M005 Authority-to-Act request writer.
// Audited entry point: start, submit, add_evidence, cancel.
// All status transitions flow through this function (table trigger blocks
// direct status mutations from non-service_role callers).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_AUTHORITY_BASES,
  type RegistryAuthorityState,
} from "../_shared/registry-authority.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const StartSchema = z.object({
  action: z.literal("start"),
  company_reference: z.string().min(1).max(120),
  company_name: z.string().min(1).max(200),
  country_code: z.string().min(2).max(8),
  representative_name: z.string().min(1).max(120),
  representative_email: z.string().email().max(200),
  representative_role: z.string().min(1).max(120),
  authority_basis: z.enum(REGISTRY_AUTHORITY_BASES),
  company_email_domain: z.string().max(120).optional(),
  claim_id: z.string().uuid().optional(),
});

const SubmitSchema = z.object({
  action: z.literal("submit"),
  authority_request_id: z.string().uuid(),
  declaration_acknowledged: z.literal(true),
  consent_to_contact: z.literal(true),
  consent_to_process_evidence: z.literal(true),
});

const EvidenceSchema = z.object({
  action: z.literal("add_evidence"),
  authority_request_id: z.string().uuid(),
  evidence_kind: z.string().min(1).max(60),
  description: z.string().min(1).max(2000),
  external_reference: z.string().max(500).optional(),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const CancelSchema = z.object({
  action: z.literal("cancel"),
  authority_request_id: z.string().uuid(),
  reason: z.string().min(1).max(2000),
});

const BodySchema = z.discriminatedUnion("action", [
  StartSchema, SubmitSchema, EvidenceSchema, CancelSchema,
]);

async function audit(svc: ReturnType<typeof createClient>, args: {
  authority_request_id: string;
  audit_event_name: string;
  previous_status: RegistryAuthorityState | null;
  new_status: RegistryAuthorityState | null;
  actor_id: string;
  payload?: Record<string, unknown>;
  reason?: string | null;
}) {
  await svc.from("registry_authority_events").insert({
    authority_request_id: args.authority_request_id,
    audit_event_name: args.audit_event_name,
    previous_status: args.previous_status,
    new_status: args.new_status,
    reason: args.reason ?? null,
    actor_id: args.actor_id,
    payload: args.payload ?? {},
  });
  await svc.from("event_store").insert({
    event_name: args.audit_event_name,
    aggregate_id: args.authority_request_id,
    aggregate_type: "registry_authority_request",
    actor_id: args.actor_id,
    payload: args.payload ?? {},
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));

    const input = parsed.data;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    if (input.action === "start") {
      const { data: row, error } = await svc.from("registry_authority_requests").insert({
        requester_user_id: user.id,
        claim_id: input.claim_id ?? null,
        company_reference: input.company_reference,
        company_name: input.company_name,
        country_code: input.country_code,
        representative_name: input.representative_name,
        representative_email: input.representative_email,
        representative_role: input.representative_role,
        authority_basis: input.authority_basis,
        company_email_domain: input.company_email_domain ?? null,
        status: "pending_evidence",
      }).select("id").single();
      if (error) throw error;
      await audit(svc, {
        authority_request_id: row.id,
        audit_event_name: "registry_authority_request_started",
        previous_status: "not_started",
        new_status: "pending_evidence",
        actor_id: user.id,
        payload: { company_reference: input.company_reference, basis: input.authority_basis },
      });
      return withCors(req, new Response(JSON.stringify({ ok: true, authority_request_id: row.id, status: "pending_evidence" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "submit") {
      const { data: existing } = await svc.from("registry_authority_requests").select("id, status, requester_user_id").eq("id", input.authority_request_id).maybeSingle();
      if (!existing || existing.requester_user_id !== user.id) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      const previous = existing.status as RegistryAuthorityState;
      if (!["pending_evidence","submitted"].includes(previous)) return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: previous }), { status: 409, headers: { "Content-Type": "application/json" } }));
      await svc.from("registry_authority_requests").update({
        status: "submitted",
        declaration_acknowledged: true,
        consent_to_contact: true,
        consent_to_process_evidence: true,
        submitted_at: new Date().toISOString(),
      }).eq("id", input.authority_request_id);
      await audit(svc, { authority_request_id: input.authority_request_id, audit_event_name: "registry_authority_request_submitted", previous_status: previous, new_status: "submitted", actor_id: user.id });
      await audit(svc, { authority_request_id: input.authority_request_id, audit_event_name: "registry_authority_status_changed", previous_status: previous, new_status: "submitted", actor_id: user.id });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "submitted" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "add_evidence") {
      const { data: existing } = await svc.from("registry_authority_requests").select("id, status, requester_user_id").eq("id", input.authority_request_id).maybeSingle();
      if (!existing || existing.requester_user_id !== user.id) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      await svc.from("registry_authority_evidence").insert({
        authority_request_id: input.authority_request_id,
        evidence_kind: input.evidence_kind,
        description: input.description,
        external_reference: input.external_reference ?? null,
        mime_type: input.mime_type ?? null,
        size_bytes: input.size_bytes ?? null,
        uploaded_by: user.id,
      });
      await audit(svc, { authority_request_id: input.authority_request_id, audit_event_name: "registry_authority_evidence_added", previous_status: null, new_status: null, actor_id: user.id, payload: { evidence_kind: input.evidence_kind } });
      return withCors(req, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "cancel") {
      const { data: existing } = await svc.from("registry_authority_requests").select("id, status, requester_user_id").eq("id", input.authority_request_id).maybeSingle();
      if (!existing || existing.requester_user_id !== user.id) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      const previous = existing.status as RegistryAuthorityState;
      await svc.from("registry_authority_requests").update({ status: "cancelled" }).eq("id", input.authority_request_id);
      await audit(svc, { authority_request_id: input.authority_request_id, audit_event_name: "registry_authority_status_changed", previous_status: previous, new_status: "cancelled", actor_id: user.id, reason: input.reason });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "cancelled" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return withCors(req, new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-authority-request error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
