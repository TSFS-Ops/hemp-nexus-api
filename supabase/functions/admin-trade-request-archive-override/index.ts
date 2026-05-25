// MT-012 — Admin override archive (active children → exception hold).
// Requires platform_admin + AAL2 + mandatory reason (≥20 chars).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { MT012_MIN_REASON_LENGTH } from "../_shared/mt-012-audit.ts";
import { recordAdminHqDecision } from "../_shared/admin-hq-audit.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  trade_request_id: z.string().uuid(),
  reason: z.string().trim().min(MT012_MIN_REASON_LENGTH).max(2000),
}).strict();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const admin_user = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: admin_user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: admin_user.id,
      action: "admin-trade-request-archive-override",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    const reasonBad = !!issues.reason?.length;
    return json(
      {
        error: reasonBad ? "reason_required" : "invalid_body",
        code: reasonBad ? "REASON_REQUIRED" : "INVALID_BODY",
        details: issues,
      },
      400,
    );
  }
  const { trade_request_id, reason } = parsed.data;

  const { data, error } = await admin.rpc("admin_archive_trade_request_override", {
    p_trade_request_id: trade_request_id,
    p_admin_user_id: admin_user.id,
    p_reason: reason,
  });

  if (error) {
    const msg = (error.message ?? "").toString();
    if (msg.includes("REASON_REQUIRED")) {
      return json({ error: "reason_required", code: "REASON_REQUIRED" }, 400);
    }
    if (msg.includes("ALREADY_ARCHIVED")) {
      return json({ error: "already_archived", code: "ALREADY_ARCHIVED" }, 409);
    }
    if (msg.includes("NOT_FOUND")) {
      return json({ error: "not_found" }, 404);
    }
    console.error("[admin-trade-request-archive-override] rpc error:", error);
    return json({ error: "override_failed" }, 500);
  }

  return json({ ok: true, result: data }, 200);
});
