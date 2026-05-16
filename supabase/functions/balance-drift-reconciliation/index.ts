/**
 * balance-drift-reconciliation — Batch V REC-001
 *
 * Read-only token balance drift detector.
 *
 *   - calls public.reconcile_token_balances()
 *   - excludes demo orgs (organizations.is_demo = true)
 *   - opens one idempotent admin_risk_items row per MISMATCH (kind='balance_drift')
 *   - NEVER mutates token_balances or token_ledger
 *   - writes admin_audit_logs:
 *       reconciliation.balance.run    (success)
 *       reconciliation.balance.failed (outer catch)
 *   - supports body { dry_run: true } to preview without opening risk items
 *   - auto-closes balance_drift risk items whose org is back in sync
 *
 * Auth:
 *   - x-internal-key: <INTERNAL_CRON_KEY> (cron path), OR
 *   - service_role bearer, OR
 *   - platform_admin bearer.
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

const SAMPLE_CAP = 50;

interface SweepBody {
  dry_run?: boolean;
  open_risk_items?: boolean;
}

interface ReconRow {
  org_id: string;
  recorded_balance: number;
  computed_balance: number;
  total_burned: number;
  total_credited: number;
  discrepancy: number;
  status: string;
}

async function recordSelfIncident(
  admin: ReturnType<typeof createClient>,
  runId: string,
  err: unknown,
) {
  const title = "Reconciliation: balance-drift-reconciliation run failed";
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
          `balance-drift-reconciliation failed at ${new Date().toISOString()}. ` +
          `run_id=${runId} error=${message}. Drift safety net did not complete.`,
        severity: "high",
        status: "open",
        kind: "balance_drift_self_incident",
      });
    }
  } catch (e) {
    console.error("[balance-drift-reconciliation] self-incident insert failed:", e);
  }
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "reconciliation.balance.failed",
      target_type: "system",
      target_id: null,
      details: { run_id: runId, error: message, source: "balance-drift-reconciliation" },
    });
  } catch (e) {
    console.error("[balance-drift-reconciliation] failure audit insert failed:", e);
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

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // 1. Pull demo orgs to exclude
    const { data: demoOrgs, error: demoErr } = await admin
      .from("organizations")
      .select("id")
      .eq("is_demo", true);
    if (demoErr) throw new Error(`DEMO_FETCH_FAILED: ${demoErr.message}`);
    const demoIds = new Set((demoOrgs ?? []).map((r) => (r as { id: string }).id));

    // 2. Run the SECURITY DEFINER reconciliation function
    const { data: rows, error: rpcErr } = await admin.rpc("reconcile_token_balances");
    if (rpcErr) throw new Error(`RECON_RPC_FAILED: ${rpcErr.message}`);

    const allRows = (rows ?? []) as ReconRow[];
    const mismatched: ReconRow[] = [];
    const okOrgIds = new Set<string>();
    for (const r of allRows) {
      if (demoIds.has(r.org_id)) continue;
      if (r.status === "MISMATCH") mismatched.push(r);
      else okOrgIds.add(r.org_id);
    }

    // 3. Open idempotent risk items (kind=balance_drift, dedup_key=org)
    let openedRiskItems = 0;
    if (openRiskItems) {
      for (const drift of mismatched) {
        const dedup = `balance_drift:${drift.org_id}`;
        const title = `Reconciliation: balance drift [org ${drift.org_id.slice(0, 8)}]`;
        const description =
          `Org ${drift.org_id} recorded balance=${drift.recorded_balance} but computed=${drift.computed_balance} ` +
          `(discrepancy=${drift.discrepancy}, burned=${drift.total_burned}, credited=${drift.total_credited}). ` +
          `No auto-repair performed. Manual investigation required.`;
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
            severity: Math.abs(drift.discrepancy) > 100 ? "critical" : "high",
            status: "open",
            kind: "balance_drift",
            org_id: drift.org_id,
            dedup_key: dedup,
            metadata: {
              recorded_balance: drift.recorded_balance,
              computed_balance: drift.computed_balance,
              discrepancy: drift.discrepancy,
              total_burned: drift.total_burned,
              total_credited: drift.total_credited,
              source: "balance-drift-reconciliation",
              run_id: runId,
            },
          });
          if (!insErr) openedRiskItems++;
        } catch (e) {
          console.error("[balance-drift-reconciliation] risk insert failed:", e);
        }
      }
    }

    // 4. Stale-risk auto-close (Batch V Fix 5)
    let autoClosed = 0;
    if (!dryRun) {
      const { data: openDrift } = await admin
        .from("admin_risk_items")
        .select("id, org_id, dedup_key")
        .eq("kind", "balance_drift")
        .eq("status", "open");
      for (const item of (openDrift ?? []) as Array<{ id: string; org_id: string | null; dedup_key: string | null }>) {
        // Only auto-close items the reconciliation job created (dedup_key starts with 'balance_drift:').
        if (!item.dedup_key || !item.dedup_key.startsWith("balance_drift:")) continue;
        if (!item.org_id) continue;
        if (!okOrgIds.has(item.org_id)) continue;
        try {
          const { error: updErr } = await admin
            .from("admin_risk_items")
            .update({
              status: "resolved",
              resolved_at: new Date().toISOString(),
              resolved_by: null,
              metadata: {
                auto_resolved: true,
                reason: "reconciliation_auto_close",
                source: "balance-drift-reconciliation",
                run_id: runId,
              },
            })
            .eq("id", item.id)
            .eq("status", "open");
          if (updErr) continue;
          autoClosed++;
          await admin.from("admin_audit_logs").insert({
            admin_user_id: null,
            action: "risk_item.auto_resolved",
            target_type: "admin_risk_item",
            target_id: item.id,
            details: {
              source: "balance-drift-reconciliation",
              reason: "reconciliation_auto_close",
              run_id: runId,
            },
          });
          await resolveNotificationsFor(admin as any, "admin_risk_item", item.id, {
            requestId: runId,
            source: "balance-drift-reconciliation",
          });
        } catch (e) {
          console.error("[balance-drift-reconciliation] auto-close failed:", e);
        }
      }
    }

    // 5. Run audit
    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "reconciliation.balance.run",
        target_type: "system",
        target_id: null,
        details: {
          run_id: runId,
          dry_run: dryRun,
          mismatched_count: mismatched.length,
          opened_risk_items: openedRiskItems,
          auto_closed: autoClosed,
          source: "balance-drift-reconciliation",
        },
      });
    } catch (e) {
      console.error("[balance-drift-reconciliation] audit insert failed:", e);
    }

    return json(200, {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      dry_run: dryRun,
      mismatched: {
        count: mismatched.length,
        samples: mismatched.slice(0, SAMPLE_CAP),
      },
      opened_risk_items: openedRiskItems,
      auto_closed: autoClosed,
    });
  } catch (err) {
    console.error("[balance-drift-reconciliation] run failed:", err);
    await recordSelfIncident(admin, runId, err);
    return json(500, {
      error: "RECONCILIATION_FAILED",
      run_id: runId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
