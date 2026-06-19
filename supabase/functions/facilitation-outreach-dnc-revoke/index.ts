/**
 * facilitation-outreach-dnc-revoke — Phase 2 Step 5
 *
 * Revokes (status='revoked') an active DNC rule.
 *
 * Authorisation:
 *   - compliance_analyst ONLY
 *   - platform_admin → 403 by design (separation of duties: the role
 *     that may open compliance escalations is not the role that may
 *     revoke the DNC rules backing those escalations)
 *
 * Audit:
 *   - emits "facilitation.dnc.rule_revoked"  (canonical, pinned by guard)
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function j(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

const BodySchema = z.object({
  rule_id: z.string().uuid(),
  reason: z.string().min(1).max(2000),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-dnc-revoke");
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
  const { data: isCA } = await admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" });
  if (!isCA) {
    return j(req, { error: "Forbidden", code: "COMPLIANCE_ANALYST_REQUIRED" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const { rule_id, reason } = parsed.data;

  const { data: rule } = await admin
    .from("facilitation_do_not_contact_rules").select("*").eq("id", rule_id).maybeSingle();
  if (!rule) return j(req, { error: "Rule not found" }, 404);
  if (rule.status !== "active") {
    return j(req, { error: "Rule already revoked", code: "DNC_RULE_ALREADY_REVOKED", status: rule.status }, 409);
  }

  const now = new Date().toISOString();
  const { error: uerr } = await admin
    .from("facilitation_do_not_contact_rules")
    .update({ status: "revoked", revoked_by: userId, revoked_at: now, revoked_reason: reason })
    .eq("id", rule_id);
  if (uerr) return j(req, { error: uerr.message }, 500);

  try {
    await admin.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "facilitation.dnc.rule_revoked",
      entity_type: "facilitation_do_not_contact_rule",
      entity_id: rule_id,
      actor_user_id: userId,
      metadata: {
        rule_type: rule.rule_type,
        value_norm: rule.value_norm,
        match_severity: rule.match_severity,
        reason,
      },
    });
  } catch (e) { console.warn("[dnc-revoke] audit insert failed", e); }

  return j(req, { ok: true, id: rule_id, status: "revoked" });
});
