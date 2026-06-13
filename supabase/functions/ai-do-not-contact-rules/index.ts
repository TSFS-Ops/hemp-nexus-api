/**
 * ai-do-not-contact-rules
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 3.
 *
 * Admin CRUD for `ai_do_not_contact_rules`. platform_admin only.
 *
 * Operations (POST body { op }):
 *   - list                     → return active rules (+ recent inactive)
 *   - create  {rule_type, rule_value, reason?}
 *       Idempotent: if an active rule with the same (rule_type, rule_value)
 *       already exists, returns it untouched. Audit fires only on new INSERT.
 *   - deactivate {rule_id}
 *       Idempotent: deactivating an already-inactive rule is a no-op (no
 *       second audit event).
 *
 * Hard guarantees:
 *   - No outreach. No send/dispatch. No POI / WaD / formal-match writes.
 *   - Sourcing (`ai-source-counterparties`) already filters on `active=true`;
 *     this function controls that list.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const RULE_TYPES = new Set([
  "specific_counterparty",
  "jurisdiction",
  "source_type",
  "opportunity_type",
  "organisation",
  "domain",
  "email",
]);

serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  return withCors(req, await _handle(req));
});

async function _handle(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  let op: string | null = null;

  try {
    const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
    requireRole(ctx, "platform_admin");
    userId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    op = typeof body?.op === "string" ? body.op : null;

    if (op === "list") {
      const { data, error } = await admin
        .from("ai_do_not_contact_rules")
        .select("*")
        .order("active", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return json(200, { rules: data ?? [] });
    }

    if (op === "create") {
      const rule_type = typeof body?.rule_type === "string" ? body.rule_type : null;
      const raw_value = typeof body?.rule_value === "string" ? body.rule_value : null;
      const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;

      if (!rule_type || !RULE_TYPES.has(rule_type)) {
        return json(400, { error: `rule_type must be one of: ${[...RULE_TYPES].join(", ")}` });
      }
      if (!raw_value || !raw_value.trim()) {
        return json(400, { error: "rule_value is required" });
      }
      const rule_value = raw_value.trim().slice(0, 500);

      // Idempotent: short-circuit on existing active rule.
      const existing = await admin
        .from("ai_do_not_contact_rules")
        .select("*")
        .eq("rule_type", rule_type)
        .eq("rule_value", rule_value)
        .eq("active", true)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        return json(200, { rule: existing.data, idempotent: true });
      }

      const ins = await admin
        .from("ai_do_not_contact_rules")
        .insert({ rule_type, rule_value, reason, created_by: userId, active: true })
        .select()
        .maybeSingle();
      if (ins.error) throw ins.error;

      await writeAdminAudit({
        admin,
        action: "ai_review.do_not_contact_rule_created",
        status: "success",
        actorUserId: userId,
        targetType: "ai_do_not_contact_rule",
        targetId: ins.data?.id ?? undefined,
        requestId,
        endpoint: "ai-do-not-contact-rules",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { rule_type, rule_value, reason },
      });

      return json(200, { rule: ins.data });
    }

    if (op === "deactivate") {
      const rule_id = typeof body?.rule_id === "string" ? body.rule_id : null;
      if (!rule_id) return json(400, { error: "rule_id is required" });

      const cur = await admin
        .from("ai_do_not_contact_rules")
        .select("*")
        .eq("id", rule_id)
        .maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) return json(404, { error: "rule not found" });

      // Idempotent: deactivating an inactive rule is a no-op.
      if (!cur.data.active) {
        return json(200, { rule: cur.data, idempotent: true });
      }

      const now = new Date().toISOString();
      const up = await admin
        .from("ai_do_not_contact_rules")
        .update({
          active: false,
          deactivated_at: now,
          deactivated_by: userId,
          updated_at: now,
        })
        .eq("id", rule_id)
        .select()
        .maybeSingle();
      if (up.error) throw up.error;

      await writeAdminAudit({
        admin,
        action: "ai_review.do_not_contact_rule_deactivated",
        status: "success",
        actorUserId: userId,
        targetType: "ai_do_not_contact_rule",
        targetId: rule_id,
        requestId,
        endpoint: "ai-do-not-contact-rules",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { rule_type: cur.data.rule_type, rule_value: cur.data.rule_value },
      });

      return json(200, { rule: up.data });
    }

    return json(400, { error: "op must be 'list' | 'create' | 'deactivate'" });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[ai-do-not-contact-rules] error:", err);
    return json(err?.statusCode ?? 500, { error: err?.message ?? "internal error", op });
  }
}
