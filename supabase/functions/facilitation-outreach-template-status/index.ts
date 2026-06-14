/**
 * facilitation-outreach-template-status
 *
 * Phase 2 Step 3 — change a facilitation outreach template's lifecycle
 * status (approve / archive). platform_admin only.
 *
 * NO outreach send path. NO POI / WaD / match / token / credit / payment
 * / poi_engagements / compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { TemplateStatusUpdateSchema } from "../_shared/facilitation-outreach-schemas.ts";
import { writeOutreachAudit } from "../_shared/facilitation-outreach-context.ts";

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return j(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authz = req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer ")) return j(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const token = authz.replace("Bearer ", "");
  const { data: claims } = await userClient.auth.getClaims(token);
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return j(req, { error: "Unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" });
  if (!isAdmin) return j(req, { error: "Forbidden", code: "PLATFORM_ADMIN_REQUIRED" }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = TemplateStatusUpdateSchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const { template_id, next_status, reason } = parsed.data;
  if (next_status === "draft") {
    return j(req, { error: "Cannot revert template to draft" }, 400);
  }

  const { data: tpl, error: terr } = await admin
    .from("facilitation_outreach_templates")
    .select("*").eq("id", template_id).maybeSingle();
  if (terr) return j(req, { error: terr.message }, 500);
  if (!tpl) return j(req, { error: "Template not found" }, 404);

  // draft -> approved | approved -> archived only.
  const allowed =
    (tpl.status === "draft" && next_status === "approved") ||
    (tpl.status === "approved" && next_status === "archived");
  if (!allowed) {
    return j(req, { error: "Illegal status transition", from: tpl.status, to: next_status }, 409);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: next_status, updated_at: now };
  if (next_status === "approved") { patch.approved_by = userId; patch.approved_at = now; }
  if (next_status === "archived") { patch.archived_by = userId; patch.archived_at = now; }

  const { error: uerr } = await admin
    .from("facilitation_outreach_templates").update(patch).eq("id", template_id);
  if (uerr) return j(req, { error: uerr.message }, 500);

  await writeOutreachAudit(admin, {
    action: next_status === "approved"
      ? "facilitation_outreach.template.approved"
      : "facilitation_outreach.template.archived",
    entity_type: "facilitation_outreach_template",
    entity_id: template_id,
    actor_user_id: userId,
    metadata: { from: tpl.status, to: next_status, reason, slug: tpl.slug, version: tpl.version },
  });

  return j(req, { ok: true, template_id, status: next_status });
});
