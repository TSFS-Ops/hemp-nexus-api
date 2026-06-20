// Batch 4 — M005 Authority-to-Act admin review writer.
// Admin/compliance-only. Auto-approval is impossible: the only path into
// approved/conditionally_approved/rejected/revoked/disputed is this function,
// and it requires platform_admin or compliance_owner plus both
// non-verification acknowledgements.
//
// Canonical non-verification copy (pinned by
// scripts/check-registry-batch4-wording.mjs):
//   "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details."
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY,
  type RegistryAuthorityState,
} from "../_shared/registry-authority.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  authority_request_id: z.string().uuid(),
  decision: z.enum(["approve", "conditionally_approve", "reject", "revoke", "dispute"]),
  rationale: z.string().min(20).max(2000),
  conditions: z.string().max(2000).optional(),
  expiry_at: z.string().datetime().optional(),
  acknowledged_not_company_verification: z.literal(true),
  acknowledged_not_bank_verification: z.literal(true),
});

function decisionToState(d: string): RegistryAuthorityState {
  switch (d) {
    case "approve": return "approved";
    case "conditionally_approve": return "conditionally_approved";
    case "reject": return "rejected";
    case "revoke": return "revoked";
    case "dispute": return "disputed";
    default: throw new Error("unknown_decision");
  }
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
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: existing } = await svc.from("registry_authority_requests").select("id, status").eq("id", input.authority_request_id).maybeSingle();
    if (!existing) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    const previous = existing.status as RegistryAuthorityState;
    const next = decisionToState(input.decision);
    const now = new Date().toISOString();

    const update: Record<string, unknown> = {
      status: next,
      reviewed_at: now,
      reviewer_id: user.id,
      conditions: input.conditions ?? null,
    };
    if (input.expiry_at) update.expiry_at = input.expiry_at;
    if (input.decision === "revoke") { update.revoked_at = now; update.revocation_reason = input.rationale; }
    if (input.decision === "dispute") { update.disputed_at = now; update.dispute_reason = input.rationale; }

    await svc.from("registry_authority_requests").update(update).eq("id", input.authority_request_id);

    await svc.from("registry_authority_reviews").insert({
      authority_request_id: input.authority_request_id,
      reviewer_id: user.id,
      decision: input.decision,
      rationale: input.rationale,
      conditions: input.conditions ?? null,
      expiry_at: input.expiry_at ?? null,
      acknowledged_not_company_verification: true,
      acknowledged_not_bank_verification: true,
    });

    const auditEvents: { audit_event_name: string }[] = [
      { audit_event_name: "registry_authority_reviewed" },
      { audit_event_name: "registry_authority_status_changed" },
    ];
    if (input.decision === "revoke") auditEvents.push({ audit_event_name: "registry_authority_revoked" });
    if (input.decision === "dispute") auditEvents.push({ audit_event_name: "registry_authority_disputed" });

    for (const e of auditEvents) {
      await svc.from("registry_authority_events").insert({
        authority_request_id: input.authority_request_id,
        audit_event_name: e.audit_event_name,
        previous_status: previous,
        new_status: next,
        reason: input.rationale,
        actor_id: user.id,
        payload: { decision: input.decision, non_verification_copy: REGISTRY_AUTHORITY_APPROVAL_NON_VERIFICATION_COPY },
      });
      await svc.from("event_store").insert({
        event_name: e.audit_event_name,
        aggregate_id: input.authority_request_id,
        aggregate_type: "registry_authority_request",
        actor_id: user.id,
        payload: { decision: input.decision, previous, next },
      }).catch(() => {});
    }

    return withCors(req, new Response(JSON.stringify({ ok: true, status: next }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-authority-review error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
