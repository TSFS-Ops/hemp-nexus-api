// Batch O DATA-004 / Fix 6: scheduled email_send_log TTL anonymisation.
//
// Runs daily via pg_cron. Calls the SECURITY DEFINER SQL function
// `anonymise_old_email_send_log(p_days, p_dry_run)` which replaces
// recipient_email on rows older than the retention window with a
// fixed placeholder. Aggregate fields (template_name, status,
// timestamps, metadata) are preserved so historical metrics still
// work. The SQL function writes its own admin audit run-summary.
//
// Auth: INTERNAL_CRON_KEY header OR service_role bearer.
// Defaults: p_days = 90, p_dry_run = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { assertNoLegalHold, RECORD_GROUP_IDS } from "../_shared/legal-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-internal-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  const cronHeader = req.headers.get("x-internal-key") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = CRON.length > 0 && cronHeader === CRON;
  const isService = authHeader === `Bearer ${SERVICE}`;
  if (!isCron && !isService) return json(401, { error: "unauthorized" });

  let body: { p_days?: number; p_dry_run?: boolean } = {};
  try {
    const txt = await req.text();
    if (txt.trim()) body = JSON.parse(txt);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const days = Math.max(30, Math.min(3650, Number(body.p_days ?? 90)));
  const dryRun = body.p_dry_run === true;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("anonymise_old_email_send_log", {
    p_days: days,
    p_dry_run: dryRun,
  });
  if (error) return json(500, { error: "rpc_failed", detail: error.message });

  return json(200, { ok: true, result: data });
});
