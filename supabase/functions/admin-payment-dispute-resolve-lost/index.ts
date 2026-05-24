// PAY-009 — Admin resolve payment dispute as LOST (issuer prevailed).
// Records append-only administrative_adjustment for any frozen credits.
// Never deletes burned ledger or POI/WaD/execution rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const Body = z.object({
  payment_dispute_id: z.string().uuid(),
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
    await assertAal2(authHeader, { adminClient: admin, callerUserId: u.user.id, action: "admin-payment-dispute-resolve-lost" });
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
  const { data, error } = await admin.rpc("resolve_payment_dispute_lost", {
    p_payment_dispute_id: p.data.payment_dispute_id,
    p_admin_user_id: u.user.id,
    p_reason: p.data.reason,
  });
  if (error) return json({ error: "rpc_failed", message: error.message }, 500);
  const r = data as { success?: boolean; code?: string };
  if (!r?.success) {
    const code = r?.code ?? "DISPUTE_FAILED";
    const status = code === "DISPUTE_NOT_FOUND" ? 404 : code === "DISPUTE_ALREADY_RESOLVED" ? 409 : 400;
    return json({ error: code.toLowerCase(), code }, status);
  }
  return json(r, 200);
});
