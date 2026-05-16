/**
 * side-effect-reconciliation — Batch V REC-004
 *
 * Detects missing fan-out side effects after canonical events. READ-ONLY.
 *
 * For each canonical audit/ledger event in a configurable window, checks
 * that the expected downstream side-effect rows exist:
 *
 *   - poi.generated / poi.minted   → at least 1 notifications row for the match
 *   - engagement.accepted          → at least 1 email_send_log row (any template) for the engagement / match
 *   - match.completed              → at least 1 notifications row + 1 email_send_log row
 *   - wad.sealed                   → at least 1 notifications row for the wad/poi
 *   - credits.purchased            → at least 1 email_send_log row for the org (receipt)
 *   - credits.refunded             → at least 1 email_send_log row for the org
 *   - admin_risk_item.resolved     → at least 1 notifications row for the risk item
 *
 * For every event that has no matching side-effect within a tolerance
 * window, opens ONE idempotent admin_risk_items row with kind=
 * 'missing_side_effect' and dedup_key=`missing_side_effect:<event_type>:<entity_id>`.
 *
 * Does NOT resend or replay. Existing retry / DLQ systems are untouched.
 *
 * Supports body { dry_run: true } to preview without opening risk items.
 *
 * Auth: x-internal-key | service_role | platform_admin (same as siblings).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";

const corsHeaders = { ...webhookCorsHeaders() };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_WINDOW_HOURS = 24;
const HARD_MAX_WINDOW_HOURS = 168; // 7d
const TOLERANCE_MIN = 30; // event must precede side-effect by ≤ tolerance; we look both ways
const ROW_LIMIT = 1000;
const SAMPLE_CAP = 25;

// Canonical event matrix. Keep extension-friendly.
export const SIDE_EFFECT_MATRIX = [
  { event_type: "poi.generated",        expected: ["notification"] },
  { event_type: "poi.minted",           expected: ["notification"] },
  { event_type: "engagement.accepted",  expected: ["email"] },
  { event_type: "match.completed",      expected: ["notification", "email"] },
  { event_type: "wad.sealed",           expected: ["notification"] },
  { event_type: "credits.purchased",    expected: ["email"] },
  { event_type: "credits.refunded",     expected: ["email"] },
  { event_type: "admin_risk_item.resolved", expected: ["notification"] },
] as const;

interface SweepBody {
  dry_run?: boolean;
  open_risk_items?: boolean;
  window_hours?: number;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  org_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

async function recordSelfIncident(
  admin: ReturnType<typeof createClient>,
  runId: string,
  err: unknown,
) {
  const title = "Reconciliation: side-effect-reconciliation run failed";
  const message = err instanceof Error ? err.message : String(err);
  try {
    const { data: existing } = await admin
      .from("admin_risk_items")
      .select("id")
      .eq("title", title)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (!existing) {
      await admin.from("admin_risk_items").insert({
        title,
        description:
          `side-effect-reconciliation failed at ${new Date().toISOString()}. ` +
          `run_id=${runId} error=${message}.`,
        severity: "high",
        status: "open",
        kind: "side_effect_self_incident",
      });
    }
  } catch (e) {
    console.error("[side-effect-reconciliation] self-incident insert failed:", e);
  }
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "reconciliation.side_effect.failed",
      target_type: "system",
      target_id: null,
      details: { run_id: runId, error: message, source: "side-effect-reconciliation" },
    });
  } catch (e) {
    console.error("[side-effect-reconciliation] failure audit insert failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const INTERNAL_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  const internalHeader = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const isInternalCron = !!INTERNAL_KEY && internalHeader === INTERNAL_KEY;
  const isServiceRole =
    SERVICE_ROLE.length > 0 && authHeader === `Bearer ${SERVICE_ROLE}`;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let isPlatformAdmin = false;
  if (!isInternalCron && !isServiceRole && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: userRes } = await admin.auth.getUser(token);
    if (userRes?.user) {
      const { data: hasAdmin } = await admin.rpc("has_role", {
        _user_id: userRes.user.id,
        _role: "platform_admin",
      });
      isPlatformAdmin = !!hasAdmin;
    }
  }
  if (!isInternalCron && !isServiceRole && !isPlatformAdmin) {
    return json(401, { error: "UNAUTHORIZED" });
  }

  let body: SweepBody = {};
  try {
    const txt = await req.text();
    if (txt.trim().length > 0) body = JSON.parse(txt) as SweepBody;
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  const dryRun = body.dry_run === true;
  const openRiskItems = body.open_risk_items !== false && !dryRun;
  const windowHours = Math.min(
    HARD_MAX_WINDOW_HOURS,
    Math.max(1, Number.isFinite(body.window_hours) ? Number(body.window_hours) : DEFAULT_WINDOW_HOURS),
  );

  const sinceIso = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const upperIso = new Date(Date.now() - TOLERANCE_MIN * 60_000).toISOString();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const eventTypes = SIDE_EFFECT_MATRIX.map((m) => m.event_type);
    const { data: events, error: evErr } = await admin
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, org_id, created_at, metadata")
      .in("action", eventTypes)
      .gte("created_at", sinceIso)
      .lte("created_at", upperIso)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT);
    if (evErr) throw new Error(`AUDIT_FETCH_FAILED: ${evErr.message}`);

    const rows = (events ?? []) as AuditRow[];

    const missing: Array<{
      event_id: string;
      event_type: string;
      entity_id: string | null;
      expected_side_effect: string;
      window_hours: number;
      occurred_at: string;
    }> = [];

    for (const ev of rows) {
      const cfg = SIDE_EFFECT_MATRIX.find((m) => m.event_type === ev.action);
      if (!cfg) continue;
      const entityId = ev.entity_id ?? (ev.metadata?.match_id as string | undefined) ?? null;
      if (!entityId) continue;

      for (const sideEffect of cfg.expected) {
        let found = false;
        if (sideEffect === "notification") {
          const { count, error } = await admin
            .from("notifications")
            .select("id", { head: true, count: "exact" })
            .or(`entity_id.eq.${entityId},link.ilike.%${entityId}%`)
            .gte("created_at", ev.created_at);
          if (error) {
            console.warn("[side-effect-reconciliation] notification probe error:", error.message);
            continue;
          }
          found = (count ?? 0) > 0;
        } else if (sideEffect === "email") {
          const orFilter = `idempotency_key.ilike.%${entityId}%,metadata->>entity_id.eq.${entityId},metadata->>match_id.eq.${entityId},metadata->>org_id.eq.${ev.org_id ?? "00000000-0000-0000-0000-000000000000"}`;
          const { count, error } = await admin
            .from("email_send_log")
            .select("id", { head: true, count: "exact" })
            .or(orFilter)
            .gte("created_at", ev.created_at);
          if (error) {
            console.warn("[side-effect-reconciliation] email probe error:", error.message);
            continue;
          }
          found = (count ?? 0) > 0;
        }

        if (!found) {
          missing.push({
            event_id: ev.id,
            event_type: ev.action,
            entity_id: entityId,
            expected_side_effect: sideEffect,
            window_hours: windowHours,
            occurred_at: ev.created_at,
          });
        }
      }
    }

    let openedRiskItems = 0;
    if (openRiskItems) {
      for (const m of missing) {
        const dedup = `missing_side_effect:${m.event_type}:${m.entity_id}:${m.expected_side_effect}`;
        const title = `Reconciliation: missing side-effect [${m.event_type} ${m.expected_side_effect}]`;
        const description =
          `Canonical event ${m.event_type} (${m.event_id}) for entity ${m.entity_id} ` +
          `at ${m.occurred_at} did not produce expected ${m.expected_side_effect} within ${windowHours}h. ` +
          `No auto-resend performed. Investigate via existing retry/DLQ systems.`;
        try {
          const { data: existing } = await admin
            .from("admin_risk_items")
            .select("id")
            .eq("dedup_key", dedup)
            .eq("status", "open")
            .limit(1)
            .maybeSingle();
          if (existing) continue;
          const { error: insErr } = await admin.from("admin_risk_items").insert({
            title,
            description,
            severity: "medium",
            status: "open",
            kind: "missing_side_effect",
            dedup_key: dedup,
            metadata: {
              event_type: m.event_type,
              event_id: m.event_id,
              entity_id: m.entity_id,
              expected_side_effect: m.expected_side_effect,
              window_hours: m.window_hours,
              source: "side-effect-reconciliation",
              request_id: runId,
            },
          });
          if (!insErr) openedRiskItems++;
        } catch (e) {
          console.error("[side-effect-reconciliation] risk insert failed:", e);
        }
      }
    }

    let autoClosed = 0;
    if (!dryRun) {
      const { data: openItems } = await admin
        .from("admin_risk_items")
        .select("id, dedup_key, metadata")
        .eq("kind", "missing_side_effect")
        .eq("status", "open")
        .limit(500);
      const stillMissing = new Set(
        missing.map((m) => `missing_side_effect:${m.event_type}:${m.entity_id}:${m.expected_side_effect}`),
      );
      for (const item of (openItems ?? []) as Array<{ id: string; dedup_key: string | null }>) {
        if (!item.dedup_key || !item.dedup_key.startsWith("missing_side_effect:")) continue;
        if (stillMissing.has(item.dedup_key)) continue;
        try {
          await admin
            .from("admin_risk_items")
            .update({
              status: "resolved",
              resolved_at: new Date().toISOString(),
              resolved_by: null,
              metadata: { auto_resolved: true, reason: "reconciliation_auto_close", source: "side-effect-reconciliation", run_id: runId },
            })
            .eq("id", item.id)
            .eq("status", "open");
          autoClosed++;
          await admin.from("admin_audit_logs").insert({
            admin_user_id: null,
            action: "risk_item.auto_resolved",
            target_type: "admin_risk_item",
            target_id: item.id,
            details: { source: "side-effect-reconciliation", reason: "reconciliation_auto_close", run_id: runId },
          });
          await resolveNotificationsFor(admin as any, "admin_risk_item", item.id, {
            requestId: runId,
            source: "side-effect-reconciliation",
          });
        } catch (e) {
          console.error("[side-effect-reconciliation] auto-close failed:", e);
        }
      }
    }

    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "reconciliation.side_effect.run",
        target_type: "system",
        target_id: null,
        details: {
          run_id: runId,
          window_hours: windowHours,
          dry_run: dryRun,
          events_scanned: rows.length,
          missing_count: missing.length,
          opened_risk_items: openedRiskItems,
          auto_closed: autoClosed,
          source: "side-effect-reconciliation",
        },
      });
    } catch (e) {
      console.error("[side-effect-reconciliation] audit insert failed:", e);
    }

    return json(200, {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      dry_run: dryRun,
      window_hours: windowHours,
      events_scanned: rows.length,
      missing: {
        count: missing.length,
        samples: missing.slice(0, SAMPLE_CAP),
      },
      opened_risk_items: openedRiskItems,
      auto_closed: autoClosed,
    });
  } catch (err) {
    console.error("[side-effect-reconciliation] run failed:", err);
    await recordSelfIncident(admin, runId, err);
    return json(500, {
      error: "RECONCILIATION_FAILED",
      run_id: runId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
