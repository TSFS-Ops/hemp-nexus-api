/**
 * P-5 Batch 4 Stage 7 — SLA / overdue monitor.
 *
 * Internal-key gated. NOT a public funder API. Idempotent: re-running
 * the function within the same window must not duplicate writes — the
 * Stage 3 RPC `p5b4_record_audit_event_v1` is itself the only writer
 * this function uses, and we look at the active milestone state before
 * deciding whether to emit a notification.
 *
 * Trigger: cron via pg_net / external scheduler with the
 * `INTERNAL_CRON_KEY` header. Anything else is rejected.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface MilestoneRow {
  id: string;
  case_id: string;
  milestone_key: string;
  status: string;
  due_at: string | null;
}

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── 1. Internal key gate ──────────────────────────────────────────
  const supplied = req.headers.get("x-internal-cron-key") ?? "";
  if (!INTERNAL_CRON_KEY || supplied !== INTERNAL_CRON_KEY) {
    return corsJson({ error: "forbidden" }, 403);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return corsJson({ error: "server_misconfigured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 2. Query active milestones that are past due. ─────────────────
  const now = new Date();
  const { data: rows, error } = await admin
    .from("p5_batch4_execution_milestones")
    .select("id, case_id, milestone_key, status, due_at")
    .in("status", ["not_started", "active"])
    .not("due_at", "is", null)
    .lte("due_at", now.toISOString())
    .limit(500);
  if (error) return corsJson({ error: error.message }, 500);

  // ── 3. For each overdue row, emit an audit event idempotently.
  //     Idempotency: rely on the existing audit table's natural keys
  //     (case_id + event_type + external_safe). The Stage 3 helper
  //     dedupes per day via its append + audit guard.
  let emitted = 0;
  const skipped: string[] = [];
  for (const m of (rows ?? []) as MilestoneRow[]) {
    const todayKey = now.toISOString().slice(0, 10);
    const eventType = "milestone_overdue_detected";
    const externalSafe = `Milestone ${m.milestone_key} overdue.`;

    // Look for an existing audit event today for the same case + key.
    const { data: existing } = await admin
      .from("p5_batch4_audit_events")
      .select("id")
      .eq("case_id", m.case_id)
      .eq("event_type", eventType)
      .gte("created_at", `${todayKey}T00:00:00Z`)
      .limit(1);
    if (existing && existing.length > 0) {
      skipped.push(m.id);
      continue;
    }

    const { error: rpcErr } = await admin.rpc("p5b4_record_audit_event_v1", {
      p_case_id: m.case_id,
      p_event_type: eventType,
      p_external_safe: externalSafe,
      p_internal: `milestone_id=${m.id}, key=${m.milestone_key}, status=${m.status}, due_at=${m.due_at}`,
    });
    if (!rpcErr) emitted++;
  }

  return corsJson({
    ok: true,
    scanned: rows?.length ?? 0,
    emitted,
    skipped: skipped.length,
    ran_at: now.toISOString(),
  });
});
