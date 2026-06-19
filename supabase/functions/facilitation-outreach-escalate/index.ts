/**
 * facilitation-outreach-escalate
 *
 * Phase 2 Step 3 — open a compliance escalation against a facilitation
 * outreach candidate. platform_admin only.
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { EscalationCreateSchema } from "../_shared/facilitation-outreach-schemas.ts";
import { writeOutreachAudit } from "../_shared/facilitation-outreach-context.ts";

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

// Step 2 schema marks candidate_id optional, but for Phase 2 escalations we
// require it (escalation must be tied to a specific outreach candidate).
const StrictEscalationSchema = EscalationCreateSchema.extend({
  candidate_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-escalate");
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
  const parsed = StrictEscalationSchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  const { facilitation_case_id, candidate_id, reason } = parsed.data;

  const { data: cand } = await admin
    .from("facilitation_outreach_candidates").select("id,facilitation_case_id")
    .eq("id", candidate_id).maybeSingle();
  if (!cand) return j(req, { error: "Candidate not found" }, 404);
  if (cand.facilitation_case_id !== facilitation_case_id) {
    return j(req, { error: "Candidate does not belong to case" }, 409);
  }

  // Block opening a second open escalation for the same candidate.
  const { count: openCount } = await admin
    .from("facilitation_compliance_escalations")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidate_id).eq("status", "open");
  if ((openCount ?? 0) > 0) {
    return j(req, { error: "Open escalation already exists", code: "ESCALATION_OPEN" }, 409);
  }

  const { data: esc, error: eerr } = await admin
    .from("facilitation_compliance_escalations").insert({
      candidate_id,
      facilitation_case_id,
      status: "open",
      reason,
      created_by: userId,
    }).select("*").maybeSingle();
  if (eerr || !esc) return j(req, { error: eerr?.message ?? "Insert failed" }, 500);

  await admin.from("facilitation_outreach_candidates")
    .update({ outreach_state: "escalated", last_gate_evaluated_at: new Date().toISOString() })
    .eq("id", candidate_id);

  const { data: kase } = await admin
    .from("facilitation_cases").select("requesting_org_id").eq("id", facilitation_case_id).maybeSingle();

  await writeOutreachAudit(admin, {
    action: "facilitation_outreach.escalation.opened",
    entity_type: "facilitation_compliance_escalation",
    entity_id: esc.id,
    actor_user_id: userId,
    org_id: kase?.requesting_org_id ?? null,
    metadata: { candidate_id, facilitation_case_id, reason },
  });

  return j(req, { ok: true, escalation_id: esc.id });
});
