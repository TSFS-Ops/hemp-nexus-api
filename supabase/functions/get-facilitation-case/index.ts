/**
 * get-facilitation-case — Phase 1 detail view.
 * Returns case + events + evidence metadata. RLS gates visibility.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const BodySchema = z.object({ case_id: z.string().uuid() });

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed" }, 400);

  // RLS-bound user client filters automatically.
  const { data: kase, error: kerr } = await userClient.from("facilitation_cases").select("*").eq("id", parsed.data.case_id).maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  const { data: events } = await userClient.from("facilitation_case_events")
    .select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: true });
  const { data: evidence } = await userClient.from("facilitation_case_evidence")
    .select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: true });

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(url, service, { auth: { persistSession: false } });

  // Batch 5 — registry/sanctions/contact records (admin/compliance/owner only).
  async function hasRole(role: string): Promise<boolean> {
    const { data } = await svc.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  }
  const isAdminish =
    (await hasRole("platform_admin"))
    || (await hasRole("compliance_analyst"))
    || (kase as { case_owner_id?: string }).case_owner_id === userId;

  let registry_checks: unknown[] = [];
  let sanctions_checks: unknown[] = [];
  let contact_attempts: unknown[] = [];
  if (isAdminish) {
    const [{ data: r }, { data: s }, { data: c }] = await Promise.all([
      svc.from("facilitation_case_registry_checks").select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: false }),
      svc.from("facilitation_case_sanctions_checks").select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: false }),
      svc.from("facilitation_case_contact_attempts").select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: false }),
    ]);
    registry_checks = r ?? [];
    sanctions_checks = s ?? [];
    contact_attempts = c ?? [];
  }

  // Batch 7 — admin/owner/compliance read triggers a non-destructive SLA
  // re-evaluation in the background. Idempotent; never advances/closes cases.
  if (isAdminish) {
    try {
      await fetch(`${url}/functions/v1/facilitation-case-sla-evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-caller": "facilitation-read",
          apikey: service,
          Authorization: `Bearer ${service}`,
        },
        body: JSON.stringify({ case_id: parsed.data.case_id, internal: true }),
      });
      // Re-read the case to pick up newly-persisted SLA fields.
      const { data: refreshed } = await svc
        .from("facilitation_cases").select("*").eq("id", parsed.data.case_id).maybeSingle();
      if (refreshed) Object.assign(kase as Record<string, unknown>, refreshed);
    } catch { /* non-fatal — caller still gets the read */ }

  // Phase 2 Step 5 — coarse outreach state for trader milestone view.
  let coarse_outreach_state: "not_started" | "in_progress" | "sent" | "blocked" = "not_started";
  try {
    const { data: cands } = await svc
      .from("facilitation_outreach_candidates")
      .select("id,outreach_state")
      .eq("facilitation_case_id", parsed.data.case_id);
    const list = cands ?? [];
    if (list.length === 0) {
      coarse_outreach_state = "not_started";
    } else {
      const { count: sentCount } = await svc
        .from("facilitation_outreach_sends")
        .select("id", { count: "exact", head: true })
        .in("candidate_id", list.map((c) => c.id))
        .eq("status", "sent");
      if ((sentCount ?? 0) > 0) coarse_outreach_state = "sent";
      else if (list.some((c) => c.outreach_state === "blocked" || c.outreach_state === "escalated")) coarse_outreach_state = "blocked";
      else coarse_outreach_state = "in_progress";
    }
  } catch { /* fall through to default */ }

  // Batch 6 — resolve linked organisation name for the drawer.
  let linked_organisation: { id: string; name: string } | null = null;
  const linkedOrgId = (kase as { linked_organization_id?: string | null }).linked_organization_id ?? null;
  if (linkedOrgId) {
    const { data: org } = await svc.from("organizations").select("id,name").eq("id", linkedOrgId).maybeSingle();
    if (org) linked_organisation = { id: (org as { id: string }).id, name: (org as { name: string }).name };
  }

  // Strip Batch 6 admin-only free-text fields for non-admin requesters.
  const ADMIN_ONLY_FIELDS = [
    "linked_organization_reason",
    "linked_organization_evidence_summary",
    "linked_organization_linked_at",
    "linked_organization_linked_by",
    "profile_record_reference",
    "profile_record_note",
    "profile_record_evidence_summary",
    "profile_record_recorded_at",
    "profile_record_recorded_by",
    "ready_for_poi_authority_summary",
    "ready_for_poi_by",
    "poi_conversion_reference",
    "poi_conversion_reason",
    "poi_conversion_evidence_summary",
    "poi_conversion_recorded_by",
    // Batch 7 — SLA fields are operational-only; never expose to requesters.
    "owner_assignment_due_at",
    "initial_triage_due_at",
    "more_info_response_due_at",
    "first_outreach_due_at",
    "follow_up_outreach_due_at",
    "compliance_review_due_at",
    "next_action_due_at",
    "is_overdue",
    "overdue_reasons",
    "sla_last_evaluated_at",
    "last_activity_at",
  ];
  const caseOut = { ...(kase as Record<string, unknown>) };
  if (!isAdminish) {
    for (const f of ADMIN_ONLY_FIELDS) delete caseOut[f];
    // Also hide the linked organisation id and resolved record from non-admins.
    delete (caseOut as Record<string, unknown>).linked_organization_id;
  }

  return json(req, {
    case: caseOut,
    events: events ?? [],
    evidence: evidence ?? [],
    coarse_outreach_state,
    registry_checks,
    sanctions_checks,
    contact_attempts,
    linked_organisation: isAdminish ? linked_organisation : null,
  });
});
