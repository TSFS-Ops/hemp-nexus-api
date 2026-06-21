// Batch 11 — registry-claim-status
// Returns a claim's status, evidence summary and (for claimants) own evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({ claim_id: z.string().uuid() });

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: claim } = await svc.from("registry_company_claims")
      .select("*").eq("id", parsed.data.claim_id).maybeSingle();
    if (!claim) return withCors(req, new Response(JSON.stringify({ error: "claim_not_found" }), { status: 404 }));

    const { data: rolesRows } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    const isAdmin = roles.includes("platform_admin") || roles.includes("compliance_owner");
    if (!isAdmin && claim.claimant_user_id !== user.id) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    }

    const { data: evidence } = await svc.from("registry_company_claim_evidence")
      .select("id, category, evidence_state, sensitive, document_name, description, issuing_authority, issue_date, expiry_date, created_at")
      .eq("claim_id", claim.id);

    const { data: events } = await svc.from("registry_company_claim_events")
      .select("audit_event_name, previous_status, new_status, reason, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return withCors(req, new Response(JSON.stringify({
      claim: {
        id: claim.id,
        workflow_status: claim.workflow_status,
        status: claim.status,
        claimant_type: claim.claimant_type,
        company_name: claim.company_name,
        company_reference: claim.company_reference,
        country_code: claim.country_code,
        sla_due_at: claim.sla_due_at,
        expires_at: claim.expires_at,
        rejection_reason: claim.rejection_reason,
      },
      evidence: evidence ?? [],
      events: events ?? [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
