/**
 * facilitation-outreach-dnc-add — Phase 2 Step 5
 *
 * Adds a Do-Not-Contact rule to `facilitation_do_not_contact_rules`.
 *
 * Authorisation:
 *   - platform_admin OR compliance_analyst may add
 *   - everyone else → 403
 *
 * Audit:
 *   - emits "facilitation.dnc.rule_added"  (canonical, pinned by guard)
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation. No platform_admin
 * compliance override surface.
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
  // SSOT vocabulary uses 'email_domain'; DB stores 'domain'.
  rule_type: z.enum(["email", "email_domain", "org_name"]),
  value: z.string().min(1).max(320),
  reason: z.string().min(1).max(2000),
  expires_at: z.string().datetime().nullable().optional(),
});

function normalise(rule_type: "email" | "email_domain" | "org_name", value: string): { db_type: "email" | "domain" | "org_name"; value_norm: string; severity: "block" | "warn" } {
  if (rule_type === "email") {
    return { db_type: "email", value_norm: value.trim().toLowerCase(), severity: "block" };
  }
  if (rule_type === "email_domain") {
    const stripped = value.trim().toLowerCase().replace(/^@/, "").replace(/^www\./, "");
    return { db_type: "domain", value_norm: stripped, severity: "block" };
  }
  return { db_type: "org_name", value_norm: value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), severity: "warn" };
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-dnc-add");
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
  const [{ data: isPA }, { data: isCA }] = await Promise.all([
    admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
    admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" }),
  ]);
  if (!isPA && !isCA) {
    return j(req, { error: "Forbidden", code: "PLATFORM_ADMIN_OR_COMPLIANCE_ANALYST_REQUIRED" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const { rule_type, value, reason, expires_at } = parsed.data;
  const { db_type, value_norm, severity } = normalise(rule_type, value);
  if (!value_norm) return j(req, { error: "Empty normalised value" }, 400);

  // Reject duplicates of an active rule with same (db_type, value_norm).
  const { data: existing } = await admin
    .from("facilitation_do_not_contact_rules")
    .select("id").eq("rule_type", db_type).eq("value_norm", value_norm).eq("status", "active").maybeSingle();
  if (existing) return j(req, { error: "Active rule already exists", code: "DNC_RULE_EXISTS", id: existing.id }, 409);

  const { data: row, error: ierr } = await admin
    .from("facilitation_do_not_contact_rules")
    .insert({
      rule_type: db_type,
      value_raw: value,
      value_norm,
      match_severity: severity,
      reason,
      source: isCA ? "compliance_analyst" : "platform_admin",
      status: "active",
      created_by: userId,
      expires_at: expires_at ?? null,
    })
    .select("*").maybeSingle();
  if (ierr || !row) return j(req, { error: ierr?.message ?? "Insert failed" }, 500);

  try {
    await admin.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "facilitation.dnc.rule_added",
      entity_type: "facilitation_do_not_contact_rule",
      entity_id: row.id,
      actor_user_id: userId,
      metadata: {
        rule_type: db_type,
        value_norm,
        match_severity: severity,
        source: row.source,
        added_by_role: isCA ? "compliance_analyst" : "platform_admin",
      },
    });
  } catch (e) { console.warn("[dnc-add] audit insert failed", e); }

  return j(req, { ok: true, id: row.id, status: row.status, rule_type: db_type, value_norm });
});
