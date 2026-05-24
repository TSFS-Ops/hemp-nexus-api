// DATA-009 Phase 2 — admin-residency-review-approve
// Platform admin only. Requires AAL2 + reason >= 20 chars. Records the
// POLICY EXCEPTION ONLY. Does NOT create any technical hosting, region
// migration, backup restriction, export restriction, or deletion.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { RESIDENCY_ADMIN_REASON_MIN_LENGTH } from "../_shared/data-009-audit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Body = z.object({
  review_id: z.string().uuid(),
  reason: z.string().min(RESIDENCY_ADMIN_REASON_MIN_LENGTH).max(4000),
}).strict();

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: u.user.id });
  if (!isAdmin) {
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: u.user.id,
      action: "data_009.approve_residency_review",
    });
  } catch (e) {
    if (e instanceof ApiException) {
      return json({ error: "mfa_required", code: e.code, message: e.message }, e.status);
    }
    throw e;
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "reason_required", code: "REASON_REQUIRED", details: parsed.error.flatten() }, 400);
  }

  const { data, error } = await admin.rpc("approve_residency_review", {
    p_review_id: parsed.data.review_id,
    p_admin_user_id: u.user.id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const msg = String(error.message || "");
    if (msg.includes("review_not_found")) return json({ error: msg, code: "REVIEW_NOT_FOUND" }, 404);
    if (msg.includes("review_already_decided")) return json({ error: msg, code: "REVIEW_ALREADY_DECIDED" }, 409);
    if (msg.includes("not_platform_admin")) return json({ error: msg, code: "NOT_PLATFORM_ADMIN" }, 403);
    if (msg.includes("reason_required_min_20")) return json({ error: msg, code: "REASON_REQUIRED" }, 400);
    console.error("[admin-residency-review-approve] rpc failed:", error);
    return json({ error: "rpc_failed", message: msg }, 500);
  }
  return json({ ok: true, ...(data ?? {}) }, 200);
});
