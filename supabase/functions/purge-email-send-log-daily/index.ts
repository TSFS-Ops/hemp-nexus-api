/**
 * DATA-004 Phase 3 — First wired retention sweeper.
 *
 * Purges (DELETEs) `email_send_log` rows whose age exceeds the
 * org's effective `email_send_log` retention window, ONLY when:
 *   - an explicit, enabled, valid `org_retention_policies` row exists
 *     for that org + record_class
 *   - no active legal hold (org-scope OR record_group sentinel) covers it
 *
 * Fail-closed in every other case. Decisions are produced by the shared
 * `decideRetention` helper so policy semantics live in exactly one place.
 *
 * Auth: INTERNAL_CRON_KEY header OR service_role bearer.
 *
 * Body (all optional, mostly for ops/testing):
 *   {
 *     "dry_run": true|false,                 // default: true
 *     "max_orgs": <number>,                  // safety cap (default 50)
 *     "max_rows_per_org": <number>           // safety cap (default 5000)
 *   }
 *
 * Evidence: every run writes rows to public.retention_run_evidence and
 * emits canonical audit events:
 *   - data.retention_job.email_send_log.started
 *   - data.retention_job.email_send_log.completed | partial | failed
 *   - data.retention_job.email_send_log.skipped (per-org skip reasons)
 *
 * This function is the ONLY sweeper authorised to consume
 * `org_retention_policies` in Phase 3 — enforced by
 * `scripts/check-data-004-phase3-enforcement-scope.mjs`.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";
import {
  decideRetention,
  type RetentionDecision,
} from "../_shared/retention-decision.ts";

export const RETENTION_JOB_AUDIT_NAMES = {
  started: "data.retention_job.email_send_log.started",
  completed: "data.retention_job.email_send_log.completed",
  partial: "data.retention_job.email_send_log.partial",
  failed: "data.retention_job.email_send_log.failed",
  skipped: "data.retention_job.email_send_log.skipped",
} as const;

const JOB_NAME = "purge-email-send-log-daily";
const RECORD_CLASS = "email_send_log" as const;

interface OrgRunCounts {
  rows_seen: number;
  rows_eligible: number;
  rows_purged: number;
  rows_skipped_missing_policy: number;
  rows_skipped_disabled_policy: number;
  rows_skipped_invalid_policy: number;
  rows_skipped_legal_hold: number;
  rows_skipped_error: number;
}

function zeroCounts(): OrgRunCounts {
  return {
    rows_seen: 0,
    rows_eligible: 0,
    rows_purged: 0,
    rows_skipped_missing_policy: 0,
    rows_skipped_disabled_policy: 0,
    rows_skipped_invalid_policy: 0,
    rows_skipped_legal_hold: 0,
    rows_skipped_error: 0,
  };
}

function addCounts(a: OrgRunCounts, b: OrgRunCounts): OrgRunCounts {
  return {
    rows_seen: a.rows_seen + b.rows_seen,
    rows_eligible: a.rows_eligible + b.rows_eligible,
    rows_purged: a.rows_purged + b.rows_purged,
    rows_skipped_missing_policy: a.rows_skipped_missing_policy + b.rows_skipped_missing_policy,
    rows_skipped_disabled_policy: a.rows_skipped_disabled_policy + b.rows_skipped_disabled_policy,
    rows_skipped_invalid_policy: a.rows_skipped_invalid_policy + b.rows_skipped_invalid_policy,
    rows_skipped_legal_hold: a.rows_skipped_legal_hold + b.rows_skipped_legal_hold,
    rows_skipped_error: a.rows_skipped_error + b.rows_skipped_error,
  };
}

function bumpForDecision(counts: OrgRunCounts, d: RetentionDecision, rows: number) {
  switch (d) {
    case "eligible_for_purge":
      counts.rows_eligible += rows;
      break;
    case "retained_not_expired":
      // age check: counted only in rows_seen
      break;
    case "skipped_due_to_missing_policy":
      counts.rows_skipped_missing_policy += rows;
      break;
    case "skipped_due_to_disabled_policy":
      counts.rows_skipped_disabled_policy += rows;
      break;
    case "skipped_due_to_invalid_policy":
      counts.rows_skipped_invalid_policy += rows;
      break;
    case "skipped_due_to_legal_hold":
      counts.rows_skipped_legal_hold += rows;
      break;
    case "skipped_due_to_error":
      counts.rows_skipped_error += rows;
      break;
  }
}

async function writeEvidence(
  admin: any,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("retention_run_evidence").insert(row);
  } catch (e) {
    console.error("[purge-email-send-log-daily] evidence write failed:", e);
  }
}

async function writeAudit(
  admin: any,
  action: string,
  orgId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: null,
      action,
      entity_type: "retention_job",
      entity_id: null,
      metadata,
    });
  } catch (e) {
    console.error(`[purge-email-send-log-daily] audit write failed (${action}):`, e);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(
    Deno.env.get("ALLOWED_ORIGINS") || "",
    req.headers.get("origin"),
  );
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const preflight = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (preflight) return preflight;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const cronHeader = req.headers.get("x-internal-key") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = CRON.length > 0 && cronHeader === CRON;
  const isService = authHeader === `Bearer ${SERVICE}`;
  if (!isCron && !isService) return json(401, { error: "unauthorized" });

  let body: { dry_run?: boolean; max_orgs?: number; max_rows_per_org?: number } = {};
  try {
    const txt = await req.text();
    if (txt.trim()) body = JSON.parse(txt);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const dryRun = body.dry_run !== false; // default to TRUE for safety
  const maxOrgs = Math.max(1, Math.min(500, Number(body.max_orgs ?? 50)));
  const maxRowsPerOrg = Math.max(1, Math.min(50000, Number(body.max_rows_per_org ?? 5000)));

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await writeAudit(admin, RETENTION_JOB_AUDIT_NAMES.started, null, {
    run_id: runId,
    job_name: JOB_NAME,
    record_class: RECORD_CLASS,
    dry_run: dryRun,
    started_at: startedAt,
  });

  await writeEvidence(admin, {
    run_id: runId,
    job_name: JOB_NAME,
    record_class: RECORD_CLASS,
    org_id: null,
    status: "started",
    started_at: startedAt,
    details: { dry_run: dryRun, max_orgs: maxOrgs, max_rows_per_org: maxRowsPerOrg },
  });

  const totals: OrgRunCounts = zeroCounts();
  const perOrgSummary: Array<{
    org_id: string;
    decision: RetentionDecision;
    counts: OrgRunCounts;
    retention_days: number | null;
  }> = [];
  let anyFailure = false;
  let anySkip = false;

  try {
    // Discover orgs with explicit email_send_log policies.
    const { data: policyRows, error: polErr } = await admin
      .from("org_retention_policies")
      .select("org_id, retention_days, metadata")
      .eq("record_class", RECORD_CLASS)
      .limit(maxOrgs);
    if (polErr) {
      anyFailure = true;
      await writeEvidence(admin, {
        run_id: runId,
        job_name: JOB_NAME,
        record_class: RECORD_CLASS,
        org_id: null,
        status: "failed",
        decision: "skipped_due_to_error",
        reason: `policy_discovery_failed: ${polErr.message}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        details: { error: polErr.message },
      });
      await writeAudit(admin, RETENTION_JOB_AUDIT_NAMES.failed, null, {
        run_id: runId,
        reason: "policy_discovery_failed",
        error: polErr.message,
      });
      return json(500, { ok: false, run_id: runId, error: "policy_discovery_failed" });
    }

    const orgIds = Array.from(new Set((policyRows ?? []).map((r: any) => r.org_id as string)));

    for (const orgId of orgIds) {
      const counts = zeroCounts();
      let orgDecision: RetentionDecision = "skipped_due_to_error";
      let retentionDays: number | null = null;
      let orgReason = "";

      try {
        // Fetch a sample row to compute a representative age for decision evaluation.
        // We use the OLDEST row so a decision of "retained" guarantees nothing is past
        // retention. For purge we will re-check ages per row in the delete query.
        const { data: oldestRows, error: oldestErr } = await admin
          .from("email_send_log")
          .select("id, created_at, metadata")
          .filter("metadata->>org_id", "eq", orgId)
          .order("created_at", { ascending: true })
          .limit(1);
        if (oldestErr) throw oldestErr;
        const oldest = (oldestRows ?? [])[0];
        const oldestAgeDays = oldest
          ? Math.floor(
              (Date.now() - new Date(oldest.created_at as string).getTime()) /
                (24 * 60 * 60 * 1000),
            )
          : 0;

        const decision = await decideRetention({
          admin,
          orgId,
          recordClass: RECORD_CLASS,
          rowAgeDays: oldestAgeDays,
          jobName: JOB_NAME,
          requestId: runId,
        });
        orgDecision = decision.decision;
        retentionDays = decision.retention_days;
        orgReason = decision.reason;

        // rows_seen: count of rows for this org regardless of decision
        const { count: seen } = await admin
          .from("email_send_log")
          .select("id", { count: "exact", head: true })
          .filter("metadata->>org_id", "eq", orgId);
        counts.rows_seen = seen ?? 0;

        if (decision.decision === "eligible_for_purge" && retentionDays) {
          const cutoff = new Date(
            Date.now() - retentionDays * 24 * 60 * 60 * 1000,
          ).toISOString();

          // Count first (capped).
          const { count: eligible } = await admin
            .from("email_send_log")
            .select("id", { count: "exact", head: true })
            .filter("metadata->>org_id", "eq", orgId)
            .lt("created_at", cutoff);
          counts.rows_eligible = Math.min(eligible ?? 0, maxRowsPerOrg);

          if (!dryRun && counts.rows_eligible > 0) {
            // Capped delete via id-in subquery.
            const { data: toDelete, error: pickErr } = await admin
              .from("email_send_log")
              .select("id")
              .filter("metadata->>org_id", "eq", orgId)
              .lt("created_at", cutoff)
              .limit(maxRowsPerOrg);
            if (pickErr) throw pickErr;
            const ids = (toDelete ?? []).map((r: any) => r.id);
            if (ids.length > 0) {
              const { error: delErr } = await admin
                .from("email_send_log")
                .delete()
                .in("id", ids);
              if (delErr) throw delErr;
              counts.rows_purged = ids.length;
            }
          }
        } else {
          // Non-eligible decision: bucket all seen rows under the skip reason
          // so the evidence table reflects what would NOT be purged.
          bumpForDecision(counts, decision.decision, counts.rows_seen);
          anySkip = true;
        }
      } catch (e) {
        anyFailure = true;
        orgDecision = "skipped_due_to_error";
        orgReason = `org_run_threw: ${(e as Error)?.message ?? "unknown"}`;
        counts.rows_skipped_error = counts.rows_seen || counts.rows_skipped_error;
      }

      await writeEvidence(admin, {
        run_id: runId,
        job_name: JOB_NAME,
        record_class: RECORD_CLASS,
        org_id: orgId,
        status: orgDecision === "eligible_for_purge"
          ? (dryRun ? "skipped" : "success")
          : "skipped",
        decision: orgDecision,
        reason: orgReason,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        rows_seen: counts.rows_seen,
        rows_eligible: counts.rows_eligible,
        rows_purged: counts.rows_purged,
        rows_skipped_missing_policy: counts.rows_skipped_missing_policy,
        rows_skipped_disabled_policy: counts.rows_skipped_disabled_policy,
        rows_skipped_invalid_policy: counts.rows_skipped_invalid_policy,
        rows_skipped_legal_hold: counts.rows_skipped_legal_hold,
        rows_skipped_error: counts.rows_skipped_error,
        details: { dry_run: dryRun, retention_days: retentionDays },
      });

      if (orgDecision !== "eligible_for_purge" && orgDecision !== "retained_not_expired") {
        await writeAudit(admin, RETENTION_JOB_AUDIT_NAMES.skipped, orgId, {
          run_id: runId,
          decision: orgDecision,
          reason: orgReason,
          retention_days: retentionDays,
        });
      }

      perOrgSummary.push({ org_id: orgId, decision: orgDecision, counts, retention_days: retentionDays });
      Object.assign(totals, addCounts(totals, counts));
    }

    const finalStatus: "success" | "partial" | "failed" = anyFailure
      ? (totals.rows_purged > 0 || perOrgSummary.some(o => o.decision === "eligible_for_purge")
          ? "partial"
          : "failed")
      : anySkip
      ? "partial"
      : "success";

    const finishedAt = new Date().toISOString();
    await writeEvidence(admin, {
      run_id: runId,
      job_name: JOB_NAME,
      record_class: RECORD_CLASS,
      org_id: null,
      status: finalStatus,
      started_at: startedAt,
      finished_at: finishedAt,
      rows_seen: totals.rows_seen,
      rows_eligible: totals.rows_eligible,
      rows_purged: totals.rows_purged,
      rows_skipped_missing_policy: totals.rows_skipped_missing_policy,
      rows_skipped_disabled_policy: totals.rows_skipped_disabled_policy,
      rows_skipped_invalid_policy: totals.rows_skipped_invalid_policy,
      rows_skipped_legal_hold: totals.rows_skipped_legal_hold,
      rows_skipped_error: totals.rows_skipped_error,
      details: { dry_run: dryRun, orgs_processed: perOrgSummary.length },
    });

    const summaryAuditAction =
      finalStatus === "success"
        ? RETENTION_JOB_AUDIT_NAMES.completed
        : finalStatus === "partial"
        ? RETENTION_JOB_AUDIT_NAMES.partial
        : RETENTION_JOB_AUDIT_NAMES.failed;
    await writeAudit(admin, summaryAuditAction, null, {
      run_id: runId,
      job_name: JOB_NAME,
      record_class: RECORD_CLASS,
      dry_run: dryRun,
      totals,
      orgs_processed: perOrgSummary.length,
      started_at: startedAt,
      finished_at: finishedAt,
    });

    return json(200, {
      ok: true,
      run_id: runId,
      job_name: JOB_NAME,
      record_class: RECORD_CLASS,
      status: finalStatus,
      dry_run: dryRun,
      totals,
      orgs_processed: perOrgSummary.length,
      started_at: startedAt,
      finished_at: finishedAt,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown";
    await writeEvidence(admin, {
      run_id: runId,
      job_name: JOB_NAME,
      record_class: RECORD_CLASS,
      org_id: null,
      status: "failed",
      decision: "skipped_due_to_error",
      reason: `job_threw: ${msg}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      details: { error: msg },
    });
    await writeAudit(admin, RETENTION_JOB_AUDIT_NAMES.failed, null, {
      run_id: runId,
      reason: "job_threw",
      error: msg,
    });
    return json(500, { ok: false, run_id: runId, error: "job_failed", detail: msg });
  }
});
