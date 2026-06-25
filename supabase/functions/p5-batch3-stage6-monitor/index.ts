// P-5 Batch 3 — Stage 6 internal monitor (cron-only, non-public).
//
// Reads only Batch 3 tables. Writes only into the Batch 3 task store via the
// SECURITY DEFINER helper. Requires an INTERNAL_CRON_KEY header — never call
// without it. Does NOT mutate Batch 1/2, trade, POI, WaD, billing, payment,
// ledger, token or business_decision rows. Does NOT expose any /api/v1/funder
// route.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

interface MonitorOutput {
  ok: true;
  heartbeat_recorded: boolean;
  tasks_recorded: number;
  scanned: { grants: number; downloads: number; requests: number };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Strict internal-cron auth. No public access. No funder access.
  const provided = req.headers.get("x-internal-cron-key") ?? "";
  if (!INTERNAL_CRON_KEY || provided !== INTERNAL_CRON_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Read-only scans of Batch 3 tables.
  const [grantsRes, requestsRes, downloadsRes] = await Promise.all([
    sb.from("p5_batch3_funder_access_grants").select("id, org_id, status, expires_at").limit(2000),
    sb.from("p5_batch3_funder_requests").select("id, grant_id, status, submitted_at").limit(2000),
    sb.from("p5_batch3_funder_downloads").select("id, grant_id, issued_at").limit(2000),
  ]);

  const now = new Date();
  const nowMs = now.getTime();
  const WARN_MS = 5 * 86_400_000;
  const TTL_MS = 7 * 86_400_000;
  const OVERDUE_MS = 5 * 86_400_000;

  type RecordTask = {
    kind: string;
    audience: "internal_admin" | "external_funder" | "system";
    idempotency_key: string;
    due_at: string;
    payload: Record<string, unknown>;
    refs: Record<string, unknown>;
  };
  const tasks: RecordTask[] = [];

  for (const g of (grantsRes.data ?? []) as Array<{ id: string; org_id: string; status: string; expires_at: string | null }>) {
    if (g.status === "revoked") {
      tasks.push({
        kind: "revoked_grant_cleanup",
        audience: "internal_admin",
        idempotency_key: `p5b3:sla:revoked:${g.id}`,
        due_at: now.toISOString(),
        payload: { summary: "Revoked grant — ensure access invalidated." },
        refs: { grant_id: g.id, org_id: g.org_id },
      });
      continue;
    }
    if (!g.expires_at) continue;
    const exp = new Date(g.expires_at).getTime();
    if (exp < nowMs) {
      tasks.push({
        kind: g.status === "expired" ? "expired_grant_unavailable" : "access_expired",
        audience: "internal_admin",
        idempotency_key: `p5b3:sla:expired:${g.id}:${g.expires_at}`,
        due_at: now.toISOString(),
        payload: { summary: "Grant expired — funder surface unavailable." },
        refs: { grant_id: g.id, org_id: g.org_id },
      });
    } else if (exp - nowMs <= WARN_MS) {
      tasks.push({
        kind: "access_expiring_warning",
        audience: "internal_admin",
        idempotency_key: `p5b3:sla:expiring:${g.id}:${g.expires_at}`,
        due_at: g.expires_at,
        payload: { summary: "Grant expiring within warning window." },
        refs: { grant_id: g.id, org_id: g.org_id },
      });
    }
  }

  for (const d of (downloadsRes.data ?? []) as Array<{ id: string; grant_id: string; issued_at: string }>) {
    const issued = new Date(d.issued_at).getTime();
    if (nowMs - issued > TTL_MS) {
      tasks.push({
        kind: "download_link_expired",
        audience: "internal_admin",
        idempotency_key: `p5b3:sla:dl-expired:${d.id}`,
        due_at: now.toISOString(),
        payload: { summary: "Watermarked download link expired (>7 days)." },
        refs: { download_id: d.id, grant_id: d.grant_id },
      });
    }
  }

  for (const r of (requestsRes.data ?? []) as Array<{ id: string; grant_id: string; status: string; submitted_at: string | null }>) {
    if (r.status !== "submitted" || !r.submitted_at) continue;
    const submitted = new Date(r.submitted_at).getTime();
    if (nowMs - submitted >= OVERDUE_MS) {
      tasks.push({
        kind: "request_overdue",
        audience: "internal_admin",
        idempotency_key: `p5b3:sla:overdue:${r.id}`,
        due_at: now.toISOString(),
        payload: { summary: "Funder request overdue for admin moderation." },
        refs: { request_id: r.id, grant_id: r.grant_id },
      });
    }
  }

  let recorded = 0;
  for (const t of tasks) {
    const { error } = await sb.rpc("p5b3_record_task_intent_v1", {
      p_kind: t.kind,
      p_audience: t.audience,
      p_idempotency_key: t.idempotency_key,
      p_due_at: t.due_at,
      p_payload: t.payload,
      p_refs: t.refs,
    });
    if (!error) recorded++;
  }

  // Heartbeat (safe pattern — reuses Batch 3 task store, not cron_heartbeats).
  const heartbeatKey = `p5b3:heartbeat:${now.toISOString().slice(0, 13)}`; // hourly bucket
  const { error: hbErr } = await sb.rpc("p5b3_record_task_intent_v1", {
    p_kind: "monitor_heartbeat",
    p_audience: "system",
    p_idempotency_key: heartbeatKey,
    p_due_at: now.toISOString(),
    p_payload: { tasks_recorded: recorded },
    p_refs: {},
  });

  const body: MonitorOutput = {
    ok: true,
    heartbeat_recorded: !hbErr,
    tasks_recorded: recorded,
    scanned: {
      grants: (grantsRes.data ?? []).length,
      downloads: (downloadsRes.data ?? []).length,
      requests: (requestsRes.data ?? []).length,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
