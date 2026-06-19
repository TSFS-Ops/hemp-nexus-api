/**
 * facilitation-outreach-candidate-add
 *
 * Phase 2 Step 3 — register an outreach candidate against a facilitation
 * case. platform_admin only. Runs the server-side gate once on insert
 * and persists the duplicate / DNC result on the candidate row.
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { CandidateAddSchema } from "../_shared/facilitation-outreach-schemas.ts";
import { runFullGate, writeOutreachAudit } from "../_shared/facilitation-outreach-context.ts";

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

function dncToColumn(reasons: readonly string[]): "block" | "warn" | "clear" {
  if (reasons.includes("dnc_email_block") || reasons.includes("dnc_domain_block")) return "block";
  if (reasons.includes("dnc_org_name_warning")) return "warn";
  return "clear";
}
function dupToColumn(reasons: readonly string[]): "red" | "amber" | "green" {
  if (reasons.includes("duplicate_exact_registry_id") || reasons.includes("duplicate_verified_domain")) return "red";
  if (reasons.includes("duplicate_soft_name_match")) return "amber";
  return "green";
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-candidate-add");
  if (__hp) return __hp;
  if (req.method !== "POST") return j(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authz = req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer ")) return j(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const { data: claims } = await userClient.auth.getClaims(authz.replace("Bearer ", ""));
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return j(req, { error: "Unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" });
  if (!isAdmin) return j(req, { error: "Forbidden", code: "PLATFORM_ADMIN_REQUIRED" }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = CandidateAddSchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const { facilitation_case_id, counterparty_org_name, contact_email, contact_name, source_note } = parsed.data;

  const { data: kase } = await admin
    .from("facilitation_cases").select("id,requesting_org_id").eq("id", facilitation_case_id).maybeSingle();
  if (!kase) return j(req, { error: "Facilitation case not found" }, 404);

  const insert = {
    facilitation_case_id,
    contact_email: contact_email.trim().toLowerCase(),
    contact_name: contact_name ?? null,
    org_name: counterparty_org_name,
    outreach_state: "new" as const,
    created_by: userId,
  };
  const { data: row, error: ierr } = await admin
    .from("facilitation_outreach_candidates").insert(insert).select("*").maybeSingle();
  if (ierr || !row) return j(req, { error: ierr?.message ?? "Insert failed" }, 500);

  // Initial gate evaluation
  const gate = await runFullGate(admin, {
    id: row.id,
    facilitation_case_id: row.facilitation_case_id,
    contact_email: row.contact_email,
    org_name: row.org_name,
  });

  await admin.from("facilitation_outreach_candidates").update({
    dnc_check_result: dncToColumn(gate.decision.reasons),
    duplicate_check_result: dupToColumn(gate.decision.reasons),
    last_gate_evaluated_at: new Date().toISOString(),
    outreach_state: gate.decision.result === "block" ? "blocked" : "new",
  }).eq("id", row.id);

  await writeOutreachAudit(admin, {
    action: "facilitation_outreach.candidate.added",
    entity_type: "facilitation_outreach_candidate",
    entity_id: row.id,
    actor_user_id: userId,
    org_id: kase.requesting_org_id,
    metadata: { facilitation_case_id, source_note: source_note ?? null, contact_email: insert.contact_email },
  });
  await writeOutreachAudit(admin, {
    action: "facilitation_outreach.gate.evaluated",
    entity_type: "facilitation_outreach_candidate",
    entity_id: row.id,
    actor_user_id: userId,
    org_id: kase.requesting_org_id,
    metadata: {
      stage: "candidate_add",
      result: gate.decision.result,
      reasons: gate.decision.reasons,
      duplicate_status: gate.duplicate_status,
      suppression_active: gate.suppression_active,
      open_escalations: gate.open_escalations,
    },
  });

  return j(req, {
    ok: true,
    candidate_id: row.id,
    gate: gate.decision,
    duplicate_status: gate.duplicate_status,
    suppression_active: gate.suppression_active,
    open_escalations: gate.open_escalations,
  });
});
