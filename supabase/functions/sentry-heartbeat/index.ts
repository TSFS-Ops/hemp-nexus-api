/**
 * OPS-001 Stage 2 — Synthetic Sentry heartbeat.
 *
 * Invoked every 15 minutes by pg_cron via `cron_invoke`. Sends a tagged
 * synthetic event to Sentry and upserts the singleton `sentry_heartbeats`
 * row so the HealthBoard tile can render an honest status:
 *
 *   - DSN missing                  → last_status = 'dsn_missing'
 *   - Ingest succeeded (2xx)       → last_status = 'success'
 *   - Ingest failed / timed out    → last_status = 'failed'
 *
 * Never throws. Always responds with structured JSON for the cron reconciler.
 * Auth: x-internal-key must match INTERNAL_CRON_KEY. No JWT.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendHeartbeatEvent, sentryDsnConfigured } from "../_shared/sentry.ts";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") || '';

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = ALLOWED_ORIGINS === "*"
    ? "*"
    : ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin ?? "")
      ? (origin ?? "")
      : ALLOWED_ORIGINS.split(",")[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  // ── Auth: internal-cron only ──
  const expected = Deno.env.get("INTERNAL_CRON_KEY");
  const provided = req.headers.get("x-internal-key");
  if (!expected || provided !== expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const dsnConfigured = sentryDsnConfigured();
  const attemptAt = new Date().toISOString();

  // ── Path 1: no DSN configured — record honest state, do NOT call Sentry. ──
  if (!dsnConfigured) {
    await admin
      .from("sentry_heartbeats")
      .upsert({
        id: true,
        last_attempt_at: attemptAt,
        last_status: "dsn_missing",
        last_http_status: null,
        last_error: "SENTRY_BACKEND_DSN not configured",
        last_event_id: null,
        dsn_configured: false,
      }, { onConflict: "id" });

    return new Response(
      JSON.stringify({
        ok: true,
        dsn_configured: false,
        status: "dsn_missing",
        message: "DSN not configured — heartbeat row updated, no event dispatched.",
      }),
      { status: 200, headers },
    );
  }

  // ── Path 2: send synthetic event and record outcome. ──
  const result = await sendHeartbeatEvent();
  const status = result.ok ? "success" : "failed";
  const upsertPayload: Record<string, unknown> = {
    id: true,
    last_attempt_at: attemptAt,
    last_status: status,
    last_http_status: result.status,
    last_error: result.error,
    last_event_id: result.event_id,
    dsn_configured: true,
  };
  if (result.ok) upsertPayload.last_success_at = attemptAt;

  const { error: upsertErr } = await admin
    .from("sentry_heartbeats")
    .upsert(upsertPayload, { onConflict: "id" });

  if (upsertErr) {
    // Heartbeat row write failed — still return 200 to cron with the
    // diagnostic so cron_reconcile_heartbeats records the underlying state.
    return new Response(
      JSON.stringify({
        ok: false,
        dsn_configured: true,
        status,
        ingest_http_status: result.status,
        ingest_error: result.error,
        event_id: result.event_id,
        heartbeat_row_error: upsertErr.message,
      }),
      { status: 200, headers },
    );
  }

  return new Response(
    JSON.stringify({
      ok: result.ok,
      dsn_configured: true,
      status,
      ingest_http_status: result.status,
      ingest_error: result.error,
      event_id: result.event_id,
    }),
    { status: result.ok ? 200 : 502, headers },
  );
});
