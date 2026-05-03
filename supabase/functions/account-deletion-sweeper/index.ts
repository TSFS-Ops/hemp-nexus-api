// D-08: Account self-delete 30-day hard-delete sweeper.
//
// Runs daily (cron) to finalise self-service account deletions:
//  - Finds profiles with status='pending_deletion' older than 30 days.
//  - In dry-run mode: writes one `account.hard_delete_candidate` audit row per
//    eligible candidate and returns counts (NO destructive action).
//  - In destructive mode: for each eligible candidate, hard-deletes the
//    auth.users row via the admin API. Profile row stays in place (already
//    anonymised by `delete-account`) so audit history remains intact.
//
// Safety controls:
//  - Requires `x-internal-key: <INTERNAL_CRON_KEY>` OR service_role bearer.
//  - `dry_run` defaults to TRUE; destructive runs require `dry_run=false`
//    AND `confirm: "HARD_DELETE"` in the body.
//  - `max_rows` capped at 100 (default 25) to bound blast radius per run.
//  - Skips: platform_admin accounts, accounts <30d old, accounts whose org
//    still has live POIs (PENDING_APPROVAL/ELIGIBLE/COMPLETION_REQUESTED)
//    or open disputes (resolved_at IS NULL). All skips audited.
//  - Fails closed: missing deletion_requested_at -> skipped+audited.
//
// Audit actions written to `admin_audit_logs`:
//   account.hard_delete_candidate  - dry-run match, eligible
//   account.hard_deleted           - destructive success
//   account.hard_delete_failed     - destructive error
//   account.hard_delete_skipped    - blocked by safety check (any mode)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";

const corsHeaders = { ...webhookCorsHeaders() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_MAX_ROWS = 25;
const HARD_MAX_ROWS = 100;
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

interface SweepBody {
  dry_run?: boolean;
  max_rows?: number;
  confirm?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  // Auth: INTERNAL_CRON_KEY header OR service_role bearer
  const internalKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedCronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const isInternalCron = !!expectedCronKey && internalKey === expectedCronKey;
  const isServiceRole = serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

  if (!isInternalCron && !isServiceRole) {
    return json(401, { error: "UNAUTHORIZED", code: "INTERNAL_CRON_KEY_REQUIRED" });
  }

  let body: SweepBody = {};
  try {
    const txt = await req.text();
    if (txt.trim().length > 0) body = JSON.parse(txt) as SweepBody;
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }

  // Default to dry-run. Destructive run requires explicit confirm.
  const dryRun = body.dry_run !== false;
  if (!dryRun && body.confirm !== "HARD_DELETE") {
    return json(400, {
      error: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
      hint: 'Pass {"dry_run": false, "confirm": "HARD_DELETE"} to perform the sweep.',
    });
  }

  const maxRows = Math.min(
    Math.max(1, Number.isFinite(body.max_rows) ? Number(body.max_rows) : DEFAULT_MAX_ROWS),
    HARD_MAX_ROWS,
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoffIso = new Date(Date.now() - GRACE_PERIOD_MS).toISOString();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // 1. Pull candidates older than the grace window. Bound by maxRows*2 so we
  //    can still report a few that get filtered out by safety checks.
  const { data: candidates, error: fetchErr } = await supabase
    .from("profiles")
    .select("id, org_id, status, deletion_requested_at, deletion_reason, deletion_category")
    .eq("status", "pending_deletion")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", cutoffIso)
    .order("deletion_requested_at", { ascending: true })
    .limit(maxRows * 2);

  if (fetchErr) {
    console.error("[account-deletion-sweeper] fetch error", fetchErr);
    return json(500, { error: "FETCH_FAILED", detail: fetchErr.message });
  }

  const result = {
    run_id: runId,
    dry_run: dryRun,
    started_at: startedAt,
    cutoff: cutoffIso,
    max_rows: maxRows,
    examined: candidates?.length ?? 0,
    candidates: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    skipped_reasons: {} as Record<string, number>,
    samples: [] as Array<Record<string, unknown>>,
  };

  if (!candidates || candidates.length === 0) {
    return json(200, { ...result, message: "No candidates due for hard-delete." });
  }

  let processedEligible = 0;

  for (const row of candidates) {
    if (processedEligible >= maxRows) break;
    const userId: string = row.id;
    const orgId: string | null = row.org_id;

    // Fail-closed: deletion_requested_at must exist & be older than cutoff.
    if (!row.deletion_requested_at) {
      await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
        run_id: runId,
        reason: "missing_deletion_requested_at",
        dry_run: dryRun,
      });
      result.skipped++;
      bump(result.skipped_reasons, "missing_deletion_requested_at");
      continue;
    }

    // Safety check: platform_admin protection (break-glass required).
    const { data: pa } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (pa) {
      await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
        run_id: runId,
        reason: "platform_admin_requires_break_glass",
        dry_run: dryRun,
      });
      result.skipped++;
      bump(result.skipped_reasons, "platform_admin_requires_break_glass");
      continue;
    }

    // Safety check: org has active POIs.
    if (orgId) {
      const { count: activePoi } = await supabase
        .from("pois")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .in("state", ["PENDING_APPROVAL", "ELIGIBLE", "COMPLETION_REQUESTED"]);
      if ((activePoi ?? 0) > 0) {
        await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
          run_id: runId,
          reason: "org_has_active_pois",
          active_poi_count: activePoi,
          dry_run: dryRun,
        });
        result.skipped++;
        bump(result.skipped_reasons, "org_has_active_pois");
        continue;
      }

      // Safety check: open disputes raised by this org.
      const { count: openDisputes } = await supabase
        .from("disputes")
        .select("id", { count: "exact", head: true })
        .eq("raised_by_org_id", orgId)
        .is("resolved_at", null);
      if ((openDisputes ?? 0) > 0) {
        await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
          run_id: runId,
          reason: "org_has_open_disputes",
          open_dispute_count: openDisputes,
          dry_run: dryRun,
        });
        result.skipped++;
        bump(result.skipped_reasons, "org_has_open_disputes");
        continue;
      }
    }

    // Eligible. Audit + (optionally) destroy.
    processedEligible++;
    const daysPending = Math.floor(
      (Date.now() - new Date(row.deletion_requested_at).getTime()) / 86_400_000,
    );

    if (dryRun) {
      await audit(supabase, "account.hard_delete_candidate", userId, orgId, {
        run_id: runId,
        deletion_requested_at: row.deletion_requested_at,
        days_pending: daysPending,
        dry_run: true,
      });
      result.candidates++;
      if (result.samples.length < 5) {
        result.samples.push({ user_id: userId, org_id: orgId, days_pending: daysPending });
      }
      continue;
    }

    // Destructive path: hard-delete the auth.users row. Profile stays for audit.
    try {
      const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
      if (delErr) throw delErr;

      await audit(supabase, "account.hard_deleted", userId, orgId, {
        run_id: runId,
        deletion_requested_at: row.deletion_requested_at,
        days_pending: daysPending,
        deletion_reason: row.deletion_reason,
        deletion_category: row.deletion_category,
      });
      result.deleted++;
      if (result.samples.length < 5) {
        result.samples.push({ user_id: userId, org_id: orgId, days_pending: daysPending, hard_deleted: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[account-deletion-sweeper] hard-delete failed for ${userId}`, msg);
      await audit(supabase, "account.hard_delete_failed", userId, orgId, {
        run_id: runId,
        error: msg,
      });
      result.failed++;
    }
  }

  return json(200, { ...result, finished_at: new Date().toISOString() });
});

function bump(obj: Record<string, number>, key: string) {
  obj[key] = (obj[key] ?? 0) + 1;
}

async function audit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  action: string,
  userId: string,
  orgId: string | null,
  details: Record<string, unknown>,
) {
  try {
    await supabase.from("admin_audit_logs").insert({
      admin_user_id: null, // system actor
      action,
      target_type: "profile",
      target_id: userId,
      details: { ...details, org_id: orgId, source: "account-deletion-sweeper" },
    });
  } catch (e) {
    console.error("[account-deletion-sweeper] audit insert failed", action, e);
  }
}
