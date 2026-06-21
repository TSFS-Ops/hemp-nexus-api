// Batch 14 — Verification expiry scan. Marks verified rows as expired when past expires_at.
// Cron-friendly. Requires INTERNAL_CRON_KEY or platform_admin JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const cronKey = req.headers.get("x-internal-cron-key") ?? "";
    let allowed = INTERNAL_CRON_KEY && cronKey === INTERNAL_CRON_KEY;
    if (!allowed) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: userRes } = await userClient.auth.getUser();
      const user = userRes?.user;
      if (!user) return json(req, 401, { error: "unauthorized" });
      const svcCheck = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const { data: roles } = await svcCheck.from("user_roles").select("role").eq("user_id", user.id);
      const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
      if (!roleSet.has("platform_admin")) return json(req, 403, { error: "forbidden" });
      allowed = true;
    }
    if (!allowed) return json(req, 403, { error: "forbidden" });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const nowIso = new Date().toISOString();

    const { data: expiredRows } = await svc.from("registry_bank_detail_verification_requests")
      .select("id, submission_id, verification_status, expires_at")
      .eq("verification_status", "verified")
      .lt("expires_at", nowIso)
      .limit(500);

    let count = 0;
    for (const row of expiredRows ?? []) {
      await svc.from("registry_bank_detail_verification_requests").update({ verification_status: "expired" }).eq("id", row.id);
      await svc.from("registry_bank_detail_submissions").update({ status: "expired" }).eq("id", row.submission_id);
      await svc.from("registry_bank_detail_verification_events").insert({
        request_id: row.id, submission_id: row.submission_id,
        audit_event_name: "registry_bank_verification_expired",
        previous_status: "verified", new_status: "expired",
        reason: "expiry_scan", payload: { expires_at: row.expires_at },
      });
      count++;
    }

    return json(req, 200, { ok: true, expired: count });
  } catch (err) {
    console.error("registry-bank-verification-expiry-scan error", err);
    return json(req, 500, { error: "internal_error" });
  }
});
