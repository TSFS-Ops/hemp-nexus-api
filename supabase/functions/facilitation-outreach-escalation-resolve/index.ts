/**
 * facilitation-outreach-escalation-resolve
 *
 * Phase 2 Step 3 — resolve or reopen a compliance escalation against a
 * facilitation outreach candidate. compliance_analyst ONLY.
 *
 * platform_admin receives 403 by design (separation of duties: the role
 * that opened the escalation may not resolve it).
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { EscalationTransitionSchema } from "../_shared/facilitation-outreach-schemas.ts";
import { writeOutreachAudit } from "../_shared/facilitation-outreach-context.ts";

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-escalation-resolve");
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

  // STRICT role separation: only compliance_analyst may resolve/reopen.
  // platform_admin is explicitly denied here even if they also hold the
  // platform_admin role — this is the documented Phase 2 contract.
  const { data: isCompliance } = await admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" });
  if (!isCompliance) {
    return j(req, { error: "Forbidden", code: "COMPLIANCE_ANALYST_REQUIRED" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = EscalationTransitionSchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  const { escalation_id, next_status, resolution_note } = parsed.data;

  const { data: esc } = await admin
    .from("facilitation_compliance_escalations").select("*").eq("id", escalation_id).maybeSingle();
  if (!esc) return j(req, { error: "Escalation not found" }, 404);

  const goingResolve = next_status === "resolved" && esc.status === "open";
  const goingReopen = next_status === "open" && esc.status === "resolved";
  if (!goingResolve && !goingReopen) {
    return j(req, { error: "Illegal transition", from: esc.status, to: next_status }, 409);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: next_status };
  if (goingResolve) {
    patch.resolved_by = userId;
    patch.resolved_at = now;
    patch.resolution_notes = resolution_note;
  } else {
    patch.reopened_by = userId;
    patch.reopened_at = now;
    patch.reopened_reason = resolution_note;
    patch.resolved_by = null;
    patch.resolved_at = null;
  }

  const { error: uerr } = await admin
    .from("facilitation_compliance_escalations").update(patch).eq("id", escalation_id);
  if (uerr) return j(req, { error: uerr.message }, 500);

  const { data: kase } = await admin
    .from("facilitation_cases").select("requesting_org_id").eq("id", esc.facilitation_case_id).maybeSingle();

  await writeOutreachAudit(admin, {
    action: goingResolve
      ? "facilitation_outreach.escalation.resolved"
      : "facilitation_outreach.escalation.reopened",
    entity_type: "facilitation_compliance_escalation",
    entity_id: escalation_id,
    actor_user_id: userId,
    org_id: kase?.requesting_org_id ?? null,
    metadata: {
      candidate_id: esc.candidate_id,
      facilitation_case_id: esc.facilitation_case_id,
      resolution_note,
    },
  });

  return j(req, { ok: true, escalation_id, status: next_status });
});
