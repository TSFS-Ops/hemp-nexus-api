/**
 * ai-auto-trigger-intel
 * ──────────────────────────────────────────────────────────────────────
 * Phase 2 AI Light-Intel Lifecycle — auto-trigger entrypoint.
 *
 * Invoked by an AFTER INSERT trigger on `public.matches` via pg_net.
 * Single chokepoint that decides whether to run AI light-intel against a
 * newly created match and dispatches to `ai-source-counterparties` only
 * for unknown / not-yet-onboarded counterparties.
 *
 * Hard guarantees:
 *   - INTERNAL-ONLY: requires `x-internal-key` matching INTERNAL_CRON_KEY.
 *   - Known counterparties are SKIPPED (no AI call).
 *   - Reruns are NOT triggered here — they remain a manual admin action.
 *   - Per-match run cap (3) is enforced by `ai-source-counterparties` via
 *     `ai_increment_match_run_count`. This function also pre-checks the
 *     auto-trigger status to avoid double enqueue on the same match.
 *   - Provider failures do NOT crash the workflow.
 *   - NEVER touches POI, WaD, outreach, formal-match, or verification rows.
 *
 * Audits:
 *   - `ai_review.auto_trigger_evaluated` for every invocation (skip/enqueued/capped)
 *   - downstream events are emitted by `ai-source-counterparties`.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MAX_RUNS_PER_MATCH = 3;
const MAX_RESULTS_PER_RUN = 10;

serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  return withCors(req, await _handle(req));
});

async function _handle(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // Internal-only.
    const providedKey = req.headers.get("x-internal-key");
    if (!internalKey || providedKey !== internalKey) {
      return json(401, { error: "unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const match_id = body?.match_id;
    if (!match_id || typeof match_id !== "string") {
      return json(400, { error: "match_id is required" });
    }

    const { data: match, error: matchErr } = await admin
      .from("matches")
      .select("id, trade_request_id, buyer_org_id, seller_org_id, ai_auto_trigger_status, ai_run_count")
      .eq("id", match_id)
      .maybeSingle();
    if (matchErr) throw matchErr;
    if (!match) return json(404, { error: "match not found" });

    // De-dupe: if we have already evaluated this match, do nothing.
    if (match.ai_auto_trigger_status && match.ai_auto_trigger_status !== "pending") {
      return json(200, { skipped: true, reason: "already_evaluated", status: match.ai_auto_trigger_status });
    }

    // Eligibility: unknown / not-yet-onboarded counterparty only.
    const { data: unknown, error: unknownErr } = await admin
      .rpc("is_counterparty_unknown_for_match", { p_match_id: match_id });
    if (unknownErr) throw unknownErr;

    if (unknown !== true) {
      await admin
        .from("matches")
        .update({ ai_auto_trigger_status: "skipped" })
        .eq("id", match_id);
      await writeAdminAudit({
        admin,
        action: "ai_review.auto_trigger_evaluated",
        status: "skipped",
        actorUserId: null,
        targetType: "match",
        targetId: match_id,
        requestId,
        endpoint: "ai-auto-trigger-intel",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { reason: "known_counterparty", trade_request_id: match.trade_request_id },
      }).catch(() => {});
      return json(200, { skipped: true, reason: "known_counterparty" });
    }

    // Pre-check run cap (source-counterparties will enforce it atomically too).
    if ((match.ai_run_count ?? 0) >= MAX_RUNS_PER_MATCH) {
      await admin
        .from("matches")
        .update({ ai_auto_trigger_status: "capped" })
        .eq("id", match_id);
      await writeAdminAudit({
        admin,
        action: "ai_review.usage_limit_exceeded",
        status: "blocked",
        actorUserId: null,
        targetType: "match",
        targetId: match_id,
        requestId,
        endpoint: "ai-auto-trigger-intel",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { limit: MAX_RUNS_PER_MATCH, kind: "runs_per_match" },
      }).catch(() => {});
      return json(429, { error: "usage_limit_exceeded", limit: MAX_RUNS_PER_MATCH });
    }

    if (!match.trade_request_id) {
      await admin
        .from("matches")
        .update({ ai_auto_trigger_status: "skipped" })
        .eq("id", match_id);
      await writeAdminAudit({
        admin,
        action: "ai_review.auto_trigger_evaluated",
        status: "skipped",
        actorUserId: null,
        targetType: "match",
        targetId: match_id,
        requestId,
        endpoint: "ai-auto-trigger-intel",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { reason: "no_trade_request_id" },
      }).catch(() => {});
      return json(200, { skipped: true, reason: "no_trade_request_id" });
    }

    // Mark enqueued, then dispatch to ai-source-counterparties.
    await admin
      .from("matches")
      .update({ ai_auto_trigger_status: "enqueued" })
      .eq("id", match_id);

    await writeAdminAudit({
      admin,
      action: "ai_review.auto_trigger_evaluated",
      status: "success",
      actorUserId: null,
      targetType: "match",
      targetId: match_id,
      requestId,
      endpoint: "ai-auto-trigger-intel",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: { decision: "enqueued", trade_request_id: match.trade_request_id },
    }).catch(() => {});

    // Internal call to ai-source-counterparties. Provider failure handling is
    // contained inside that function — it returns 200 with provider_failure
    // metadata rather than crashing.
    let dispatchStatus = "completed";
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/ai-source-counterparties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": internalKey,
        },
        body: JSON.stringify({
          trade_request_id: match.trade_request_id,
          match_id,
          max_results: MAX_RESULTS_PER_RUN,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        dispatchStatus = resp.status === 429 ? "capped" : "failed";
      } else if (payload?.provider_failure?.material) {
        dispatchStatus = "provider_failed";
      }
    } catch (e) {
      console.warn("[ai-auto-trigger-intel] dispatch failed", e);
      dispatchStatus = "failed";
    }

    await admin
      .from("matches")
      .update({ ai_auto_trigger_status: dispatchStatus })
      .eq("id", match_id);

    return json(200, { enqueued: true, dispatch_status: dispatchStatus });
  } catch (e: any) {
    console.error("[ai-auto-trigger-intel] error:", e);
    return json(500, { error: e?.message ?? "internal error" });
  }
}
