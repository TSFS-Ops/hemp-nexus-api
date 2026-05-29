/**
 * DATA-004 Phase 3 (+ Phase 3.1 evidence hardening) — Wired retention sweeper.
 *
 * Purges (DELETEs) `email_send_log` rows whose age exceeds the org's
 * effective `email_send_log` retention window, ONLY when:
 *   - an explicit, enabled, valid `org_retention_policies` row exists
 *     for that org + record_class
 *   - no active legal hold (org-scope OR record_group sentinel) covers it
 *
 * Fail-closed in every other case. Decisions are produced by the shared
 * `decideRetention` helper so policy semantics live in exactly one place.
 *
 * Phase 3.1 hardening:
 *  1. **Candidate discovery** — enumerate orgs that actually have
 *     `email_send_log` rows (via `discover_email_send_log_candidate_orgs`),
 *     so orgs WITHOUT an explicit retention policy are explicitly recorded
 *     in `retention_run_evidence` as `skipped_due_to_missing_policy` rather
 *     than silently protected by absence-from-iteration.
 *  2. **Lifecycle is evidence-only.** Run-level lifecycle events
 *     (`started`/`completed`/`partial`/`failed`) are written to
 *     `retention_run_evidence`, NOT to `audit_logs`, because
 *     `audit_logs.org_id` is NOT NULL and there is no platform-system org.
 *     The canonical lifecycle SSOT is `retention_run_evidence`.
 *  3. **Per-org `skipped` audits persist** to `audit_logs` (real `org_id`).
 *     Audit-write failures are tracked and surfaced in the run evidence
 *     and the function response — never silently swallowed.
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
 * Canonical names (pinned by check-data-004-phase3-audit-names.mjs):
 *   - data.retention_job.email_send_log.started     (evidence status only)
 *   - data.retention_job.email_send_log.completed   (evidence status only)
 *   - data.retention_job.email_send_log.partial     (evidence status only)
 *   - data.retention_job.email_send_log.failed      (evidence status only)
 *   - data.retention_job.email_send_log.skipped     (persists to audit_logs
 *                                                    per-org with real org_id)
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

/**
 * Persistence contract for the canonical names above (Phase 3.1):
 *
 *   - `skipped` → persists to public.audit_logs (per-org row, real org_id).
 *   - `started`, `completed`, `partial`, `failed` → run-level lifecycle
 *     events. They are recorded as `details.lifecycle_event_name` on
 *     `retention_run_evidence` rows, NOT in `audit_logs`, because
 *     `audit_logs.org_id` is NOT NULL and there is no platform org.
 */
export const RETENTION_JOB_AUDIT_PERSISTENCE = {
  started: "evidence_only",
  completed: "evidence_only",
  partial: "evidence_only",
  failed: "evidence_only",
  skipped: "audit_logs_per_org",
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

interface AuditWriteFailure {
  action: string;
  org_id: string | null;
  error: string;
}

async function writeEvidence(
  admin: any,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await admin.from("retention_run_evidence").insert(row);
    if (error) {
      console.error("[purge-email-send-log-daily] evidence write failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown";
    console.error("[purge-email-send-log-daily] evidence write threw:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Phase 3.1: per-org `skipped` audit writer.
 *
 * Returns `{ ok, error }`; the caller MUST surface any failure into the
 * run evidence + response so audit failures are never silently swallowed.
 * This writer is only ever called with a real org_id (per-org skip).
 */
async function writePerOrgSkipAudit(
  admin: any,
  orgId: string,
  metadata: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: null,
      action: RETENTION_JOB_AUDIT_NAMES.skipped,
      entity_type: "retention_job",
      entity_id: null,
      metadata,
    });
    if (error) {
      console.error(
        `[purge-email-send-log-daily] per-org skipped audit failed (org=${orgId}):`,
        error.message,
      );
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown";
    console.error(
      `[purge-email-send-log-daily] per-org skipped audit threw (org=${orgId}):`,
      msg,
    );
    return { ok: false, error: msg };
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
  const auditWriteFailures: AuditWriteFailure[] = [];
  const evidenceWriteFailures: Array<{ phase: string; error: string }> = [];

  // Phase 3.1: lifecycle events are evidence-only — recorded in
  // retention_run_evidence.details.lifecycle_event_name, not in audit_logs.
  const startEv = await writeEvidence(admin, {
    run_id: runId,
    job_name: JOB_NAME,
    record_class: RECORD_CLASS,
    org_id: null,
    status: "started",
    started_at: startedAt,
    details: {
      dry_run: dryRun,
      max_orgs: maxOrgs,
      max_rows_per_org: maxRowsPerOrg,
      lifecycle_event_name: RETENTION_JOB_AUDIT_NAMES.started,
      lifecycle_persistence: "evidence_only",
    },
  });
  if (!startEv.ok) {
    evidenceWriteFailures.push({ phase: "started", error: startEv.error ?? "unknown" });
  }

  const totals: OrgRunCounts = zeroCounts();
  const perOrgSummary: Array<{
    org_id: string;
    decision: RetentionDecision;
    counts: OrgRunCounts;
    retention_days: number | null;
    reason: string;
  }> = [];
  let anyFailure = false;
  let anySkip = false;

  try {
    // Phase 3.1: candidate discovery — orgs that actually have email_send_log
    // rows, regardless of whether an explicit retention policy exists.
    const { data: candRows, error: candErr } = await admin.rpc(
      "discover_email_send_log_candidate_orgs",
      { p_limit: maxOrgs },
    );
    if (candErr) {
      anyFailure = true;
      await writeEvidence(admin, {
        run_id: runId,
        job_name: JOB_NAME,
        record_class: RECORD_CLASS,
        org_id: null,
        status: "failed",
        decision: "skipped_due_to_error",
        reason: `candidate_discovery_failed: ${candErr.message}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        details: {
          error: candErr.message,
          lifecycle_event_name: RETENTION_JOB_AUDIT_NAMES.failed,
          lifecycle_persistence: "evidence_only",
        },
      });
      return json(500, {
        ok: false,
        run_id: runId,
        error: "candidate_discovery_failed",
        detail: candErr.message,
        audit_write_failures: auditWriteFailures,
        evidence_write_failures: evidenceWriteFailures,
      });
    }

    const candidates = (candRows ?? []) as Array<{
      org_id: string;
      row_count: number;
      oldest_created_at: string | null;
    }>;

    for (const cand of candidates) {
      const orgId = cand.org_id;
      const counts = zeroCounts();
      let orgDecision: RetentionDecision = "skipped_due_to_error";
      let retentionDays: number | null = null;
      let orgReason = "";

      try {
        const oldest = cand.oldest_created_at;
        const oldestAgeDays = oldest
          ? Math.floor(
              (Date.now() - new Date(oldest).getTime()) /
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

        counts.rows_seen = Number(cand.row_count) || 0;

        if (decision.decision === "eligible_for_purge" && retentionDays) {
          const cutoff = new Date(
            Date.now() - retentionDays * 24 * 60 * 60 * 1000,
          ).toISOString();

          const { count: eligible } = await admin
            .from("email_send_log")
            .select("id", { count: "exact", head: true })
            .filter("metadata->>org_id", "eq", orgId)
            .lt("created_at", cutoff);
          counts.rows_eligible = Math.min(eligible ?? 0, maxRowsPerOrg);

          if (!dryRun && counts.rows_eligible > 0) {
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
          // Bucket the candidate row count under the skip reason so evidence
          // reflects what was protected (including missing-policy orgs).
          bumpForDecision(counts, decision.decision, counts.rows_seen);
          anySkip = true;
        }
      } catch (e) {
        anyFailure = true;
        orgDecision = "skipped_due_to_error";
        orgReason = `org_run_threw: ${(e as Error)?.message ?? "unknown"}`;
        counts.rows_skipped_error = counts.rows_seen || counts.rows_skipped_error;
      }

      const orgEvidenceRow: Record<string, unknown> = {
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
      };
      const evRes = await writeEvidence(admin, orgEvidenceRow);
      if (!evRes.ok) {
        evidenceWriteFailures.push({
          phase: `org:${orgId}`,
          error: evRes.error ?? "unknown",
        });
      }

      // Per-org skipped audits land in audit_logs with real org_id.
      if (orgDecision !== "eligible_for_purge" && orgDecision !== "retained_not_expired") {
        const ar = await writePerOrgSkipAudit(admin, orgId, {
          run_id: runId,
          decision: orgDecision,
          reason: orgReason,
          retention_days: retentionDays,
          job_name: JOB_NAME,
          record_class: RECORD_CLASS,
        });
        if (!ar.ok) {
          auditWriteFailures.push({
            action: RETENTION_JOB_AUDIT_NAMES.skipped,
            org_id: orgId,
            error: ar.error ?? "unknown",
          });
          // Surface inline in evidence too so HQ can see audit drift.
          await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "skipped",
            decision: orgDecision,
            reason: `audit_write_failed: ${ar.error ?? "unknown"}`,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            details: {
              dry_run: dryRun,
              audit_write_failure: true,
              audit_action: RETENTION_JOB_AUDIT_NAMES.skipped,
            },
          });
        }
      }

      perOrgSummary.push({
        org_id: orgId,
        decision: orgDecision,
        counts,
        retention_days: retentionDays,
        reason: orgReason,
      });
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
    const finalEvent =
      finalStatus === "success"
        ? RETENTION_JOB_AUDIT_NAMES.completed
        : finalStatus === "partial"
        ? RETENTION_JOB_AUDIT_NAMES.partial
        : RETENTION_JOB_AUDIT_NAMES.failed;

    const finalEv = await writeEvidence(admin, {
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
      details: {
        dry_run: dryRun,
        orgs_processed: perOrgSummary.length,
        lifecycle_event_name: finalEvent,
        lifecycle_persistence: "evidence_only",
        audit_write_failures: auditWriteFailures,
        evidence_write_failures: evidenceWriteFailures,
      },
    });
    if (!finalEv.ok) {
      evidenceWriteFailures.push({ phase: "final", error: finalEv.error ?? "unknown" });
    }

    return json(200, {
      ok: true,
      run_id: runId,
      job_name: JOB_NAME,
      record_class: RECORD_CLASS,
      status: finalStatus,
      lifecycle_event_name: finalEvent,
      lifecycle_persistence: "evidence_only",
      dry_run: dryRun,
      totals,
      orgs_processed: perOrgSummary.length,
      per_org: perOrgSummary.map((o) => ({
        org_id: o.org_id,
        decision: o.decision,
        reason: o.reason,
        retention_days: o.retention_days,
        counts: o.counts,
      })),
      started_at: startedAt,
      finished_at: finishedAt,
      audit_write_failures: auditWriteFailures,
      evidence_write_failures: evidenceWriteFailures,
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
      details: {
        error: msg,
        lifecycle_event_name: RETENTION_JOB_AUDIT_NAMES.failed,
        lifecycle_persistence: "evidence_only",
        audit_write_failures: auditWriteFailures,
        evidence_write_failures: evidenceWriteFailures,
      },
    });
    return json(500, {
      ok: false,
      run_id: runId,
      error: "job_failed",
      detail: msg,
      audit_write_failures: auditWriteFailures,
      evidence_write_failures: evidenceWriteFailures,
    });
  }
});
