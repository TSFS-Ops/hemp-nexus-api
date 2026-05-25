// DEC-007 — Admin decline refund. platform_admin + AAL2 + reason ≥ 20 chars.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { recordAdminHqDecision } from "../_shared/admin-hq-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const Body = z.object({
  refund_request_id: z.string().uuid(),
  reason: z.string().trim().min(20).max(2000),
}).strict();
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: u.user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  try {
    await assertAal2(authHeader, { adminClient: admin, callerUserId: u.user.id, action: "admin-refund-decline" });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    return json({ error: "aal_check_failed" }, 500);
  }
  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const p = Body.safeParse(raw);
  if (!p.success) {
    const issues = p.error.flatten().fieldErrors;
    return json({ error: issues.reason ? "reason_required" : "invalid_body", code: issues.reason ? "REASON_REQUIRED" : "INVALID_BODY", details: issues }, 400);
  }
  const { data, error } = await admin.rpc("decline_refund", {
    p_refund_request_id: p.data.refund_request_id,
    p_admin_user_id: u.user.id,
    p_reason: p.data.reason,
  });
  if (error) return json({ error: "rpc_failed", message: error.message }, 500);
  const r = data as { success?: boolean; code?: string };
  if (!r?.success) {
    const code = r?.code ?? "REFUND_FAILED";
    const status = code === "REFUND_NOT_FOUND" ? 404 : code === "REFUND_ALREADY_DECIDED" ? 409 : 400;
    return json({ error: code.toLowerCase(), code }, status);
  }
  const { data: rr } = await admin.from("refund_requests")
    .select("org_id, token_purchase_id").eq("id", p.data.refund_request_id).maybeSingle();
  try {
    await recordAdminHqDecision({
      admin, sourceFunction: "admin-refund-decline", actionCode: "refund.decline",
      actorUserId: u.user.id, actorRole: "platform_admin",
      orgId: rr?.org_id ?? "00000000-0000-0000-0000-000000000000",
      aggregateId: p.data.refund_request_id, aggregateType: "refund_request",
      reason: p.data.reason, requestId: req.headers.get("x-request-id"),
      paymentReference: rr?.token_purchase_id ?? null, aal: "aal2",
    });
  } catch (govErr) {
    console.error("[admin-refund-decline] CRITICAL: gov audit failed:", govErr);
    return json({ error: "gov_audit_write_failed", code: "GOV_AUDIT_WRITE_FAILED" }, 500);
  }
  return json(r, 200);
});
