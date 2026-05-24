// OPS-010 — Admin: archive demo workspace (platform_admin + AAL2 + reason >= 20)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { OPS_010_MIN_REASON_LENGTH } from "../_shared/ops-010-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  dataset_id: z.string().uuid(),
  reason: z.string().trim().min(OPS_010_MIN_REASON_LENGTH).max(2000),
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
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: userData.user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, { adminClient: admin, callerUserId: userData.user.id, action: "admin-demo-workspace-archive" });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const reasonBad = !!parsed.error.flatten().fieldErrors.reason?.length;
    return json({ error: reasonBad ? "reason_required" : "invalid_body", code: reasonBad ? "REASON_REQUIRED" : "INVALID_BODY", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { data, error } = await admin.rpc("archive_demo_workspace", {
    p_admin_user_id: userData.user.id,
    p_dataset_id: parsed.data.dataset_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const msg = (error.message ?? "").toString();
    if (msg.includes("REASON_REQUIRED")) return json({ error: "reason_required", code: "REASON_REQUIRED" }, 400);
    if (msg.includes("NOT_PLATFORM_ADMIN")) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
    if (msg.includes("WORKSPACE_NOT_FOUND")) return json({ error: "not_found", code: "WORKSPACE_NOT_FOUND" }, 404);
    return json({ error: "rpc_failed", message: msg }, 500);
  }
  return json({ ok: true, ...(data as object) });
});
