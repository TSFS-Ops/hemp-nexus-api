// Batch 11 — registry-claim-conflict-resolve
// Admin/compliance-only. Records a resolution outcome across one or more claims
// that share a company_reference. No automatic winner selection.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_CLAIM_CONFLICT_OUTCOMES } from "../_shared/registry-claim-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  company_reference: z.string().min(1),
  outcome: z.enum(REGISTRY_CLAIM_CONFLICT_OUTCOMES as unknown as [string, ...string[]]),
  reason: z.string().min(10).max(2000),
  approved_claim_ids: z.array(z.string().uuid()).optional(),
  rejected_claim_ids: z.array(z.string().uuid()).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: rolesRows } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    if (!roles.includes("platform_admin") && !roles.includes("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden_admin_required" }), { status: 403 }));
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }));
    const { outcome, reason, company_reference, approved_claim_ids = [], rejected_claim_ids = [] } = parsed.data;

    if (approved_claim_ids.length) {
      await svc.from("registry_company_claims").update({ workflow_status: "approved", status: "approved", last_status_change_at: new Date().toISOString() })
        .in("id", approved_claim_ids);
    }
    if (rejected_claim_ids.length) {
      await svc.from("registry_company_claims").update({ workflow_status: "rejected", status: "rejected", rejection_reason: reason, last_status_change_at: new Date().toISOString() })
        .in("id", rejected_claim_ids);
    }

    // Audit for each touched claim
    const all = [...approved_claim_ids, ...rejected_claim_ids];
    for (const cid of all) {
      await svc.from("registry_company_claim_events").insert({
        claim_id: cid, audit_event_name: "registry_claim_conflict_resolved",
        actor_user_id: user.id, reason,
      });
    }
    await svc.from("audit_logs").insert({
      action: "registry_claim_conflict_resolved",
      actor_user_id: user.id,
      metadata: { company_reference, outcome, approved_claim_ids, rejected_claim_ids, reason },
    });

    return withCors(req, new Response(JSON.stringify({ ok: true, outcome }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
