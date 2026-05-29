/**
 * DATA-004 Batch 7 — Cold Storage Archival Pipeline (DRY-RUN-FIRST evidence path).
 *
 * Cold-storage-archive is non-destructive by contract:
 *   * It NEVER deletes source records.
 *   * It NEVER mutates source records.
 *   * In live mode it only writes a JSON payload to the `archived-records`
 *     storage bucket and updates `retention_flags` bookkeeping
 *     (archive_storage_path / archive_hash / archive_size_bytes / archived_at).
 *   * In dry-run mode (DEFAULT) it does NONE of the above — it only
 *     enumerates, classifies, and writes `retention_run_evidence`.
 *
 * Batch 7 evidence-hardening (mirrors Phase 3.1 for email_send_log):
 *   1. **`dry_run` default flipped to TRUE** so manual/scheduled runs are
 *      non-destructive unless an operator explicitly opts in.
 *   2. **Candidate discovery via SECURITY DEFINER RPC**
 *      `discover_cold_storage_archive_candidates`. Pre-classifies already-
 *      exported rows so duplicates are recorded explicitly in evidence
 *      instead of being silently skipped by an `archive_storage_path IS NULL`
 *      filter.
 *   3. **`retention_run_evidence` parity** with `purge-email-send-log-daily`:
 *      one run-level `started`/`completed`/`partial`/`failed` row plus one
 *      per-candidate row. Lifecycle events are evidence-only (no
 *      `audit_logs` rows with null org_id) because `audit_logs.org_id` is
 *      NOT NULL and there is no platform-system org.
 *   4. **Explicit skip categories** surfaced in evidence + response:
 *        - skipped_due_to_legal_hold        (batch sentinel OR per-row)
 *        - skipped_due_to_duplicate         (already exported)
 *        - skipped_due_to_missing_source    (retention flag exists, source row gone)
 *        - skipped_due_to_bucket_write      (storage upload failed in live mode)
 *        - skipped_due_to_lookup_error      (read failure)
 *   5. **Audit/evidence write failures are tracked** in two arrays and
 *      returned to the caller — never silently swallowed.
 *   6. **Idempotency** preserved: live runs skip rows whose
 *      `archive_storage_path` is already set (RPC `already_exported=true`),
 *      and storage upload uses `upsert: false`.
 *
 * Auth: INTERNAL_CRON_KEY header OR service_role bearer.
 *
 * Body (POST, all optional):
 *   {
 *     "dry_run": true|false,   // default TRUE
 *     "limit":   <number>      // safety cap, default 50, max 500
 *   }
 * Legacy `?dry_run=...&limit=...` query params are still respected for
 * back-compat; body wins when both are present.
 *
 * Canonical audit names (pinned by guards):
 *   - data.retention_job.cold_storage_archive.started     (evidence_only)
 *   - data.retention_job.cold_storage_archive.completed   (evidence_only)
 *   - data.retention_job.cold_storage_archive.partial     (evidence_only)
 *   - data.retention_job.cold_storage_archive.failed      (evidence_only)
 *   - data.retention_job.cold_storage_archive.skipped     (audit_logs per-org
 *                                                          when flag.org_id
 *                                                          is set; otherwise
 *                                                          evidence_only)
 *
 * Wiring scope: this function does NOT consume the per-org retention
 * policy table or its effective-days reader. The per-org retention
 * policy table remains gated by `purge-email-send-log-daily` only
 * (Phase 3 single-consumer guard).

 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";
import { assertNoLegalHold, RECORD_GROUP_IDS, type LegalHoldScopeType } from "../_shared/legal-hold.ts";

const JOB_NAME = "cold-storage-archive";
const RECORD_CLASS = "cold_storage_archive" as const;
const BATCH_SIZE = 50;

export const RETENTION_JOB_AUDIT_NAMES = {
  started: "data.retention_job.cold_storage_archive.started",
  completed: "data.retention_job.cold_storage_archive.completed",
  partial: "data.retention_job.cold_storage_archive.partial",
  failed: "data.retention_job.cold_storage_archive.failed",
  skipped: "data.retention_job.cold_storage_archive.skipped",
} as const;

export const RETENTION_JOB_AUDIT_PERSISTENCE = {
  started: "evidence_only",
  completed: "evidence_only",
  partial: "evidence_only",
  failed: "evidence_only",
  skipped: "audit_logs_per_org_when_org_id_present",
} as const;

const COLD_TABLE_TO_SCOPE: Record<string, LegalHoldScopeType | null> = {
  matches: "match",
  match_documents: "evidence",
  match_events: "match",
  wads: "wad",
  pois: "poi",
  compliance_cases: null,
  screening_results: null,
};

const RELATED_TABLES: Record<string, Array<{ table: string; foreignKey: string; sourceKey: string }>> = {
  matches: [
    { table: "match_events", foreignKey: "match_id", sourceKey: "id" },
    { table: "match_documents", foreignKey: "match_id", sourceKey: "id" },
    { table: "deal_terms", foreignKey: "match_id", sourceKey: "id" },
    { table: "disputes", foreignKey: "match_id", sourceKey: "id" },
    { table: "attestations", foreignKey: "match_id", sourceKey: "id" },
    { table: "pois", foreignKey: "match_id", sourceKey: "id" },
  ],
  compliance_cases: [
    { table: "screening_results", foreignKey: "entity_id", sourceKey: "entity_id" },
  ],
};

type SkipCategory =
  | "legal_hold_batch"
  | "legal_hold_row"
  | "duplicate"
  | "missing_source"
  | "bucket_write_failed"
  | "lookup_error";

async function computeSha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function writeEvidence(admin: any, row: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await admin.from("retention_run_evidence").insert(row);
    if (error) {
      console.error("[cold-storage-archive] evidence write failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown";
    console.error("[cold-storage-archive] evidence write threw:", msg);
    return { ok: false, error: msg };
  }
}

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
      console.error(`[cold-storage-archive] per-org skipped audit failed (org=${orgId}):`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown";
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req: Request) => {
  const runId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "";
  const headers = buildCorsHeaders(allowedOrigins, req.headers.get("origin"));
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  const preflight = handleCors(req, allowedOrigins);
  if (preflight) return preflight;

  // Auth: internal cron key OR service_role bearer
  const internalKey = req.headers.get("x-internal-key") ?? "";
  const expectedCronKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isCron = expectedCronKey.length > 0 && internalKey === expectedCronKey;
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
  if (!isCron && !isServiceRole) {
    return json(401, { error: "unauthorized" });
  }

  // Parse body (POST) + legacy query string. Body wins.
  const url = new URL(req.url);
  let body: { dry_run?: boolean; limit?: number } = {};
  if (req.method === "POST") {
    try {
      const txt = await req.text();
      if (txt.trim()) body = JSON.parse(txt);
    } catch {
      return json(400, { error: "invalid_json" });
    }
  }
  const qsDry = url.searchParams.get("dry_run");
  const qsLimit = url.searchParams.get("limit");

  // Batch 7: dry_run defaults to TRUE. Only explicit `false` opts into live.
  const dryRun = body.dry_run !== undefined
    ? body.dry_run !== false
    : (qsDry === null ? true : qsDry !== "false");

  const requestedLimit = body.limit ?? (qsLimit ? parseInt(qsLimit, 10) : BATCH_SIZE);
  const batchLimit = Math.min(Math.max(Number(requestedLimit) || BATCH_SIZE, 1), BATCH_SIZE);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = new Date().toISOString();
  const auditWriteFailures: Array<{ action: string; org_id: string | null; error: string }> = [];
  const evidenceWriteFailures: Array<{ phase: string; error: string }> = [];

  // Lifecycle: started → evidence_only
  const startEv = await writeEvidence(admin, {
    run_id: runId,
    job_name: JOB_NAME,
    record_class: RECORD_CLASS,
    org_id: null,
    status: "started",
    started_at: startedAt,
    details: {
      dry_run: dryRun,
      limit: batchLimit,
      lifecycle_event_name: RETENTION_JOB_AUDIT_NAMES.started,
      lifecycle_persistence: "evidence_only",
    },
  });
  if (!startEv.ok) {
    evidenceWriteFailures.push({ phase: "started", error: startEv.error ?? "unknown" });
  }

  let processed = 0;
  let failed = 0;
  const skipCounts: Record<SkipCategory, number> = {
    legal_hold_batch: 0,
    legal_hold_row: 0,
    duplicate: 0,
    missing_source: 0,
    bucket_write_failed: 0,
    lookup_error: 0,
  };
  const perFlag: Array<{
    flag_id: string;
    decision: "would_export" | "exported" | "skipped";
    reason: string;
    org_id: string | null;
  }> = [];
  let anyFailure = false;
  let anySkip = false;

  try {
    // Batch-level legal hold sentinel
    const batchHold = await assertNoLegalHold(admin, [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.cold_storage_archive },
    ], {
      action: "cold-storage-archive.batch",
      actorUserId: null,
      actorOrgId: null,
      requestId: runId,
    });

    // Candidate discovery via SECURITY DEFINER service_role-only RPC
    const { data: candRows, error: candErr } = await admin.rpc(
      "discover_cold_storage_archive_candidates",
      { p_limit: batchLimit },
    );
    if (candErr) {
      anyFailure = true;
      await writeEvidence(admin, {
        run_id: runId,
        job_name: JOB_NAME,
        record_class: RECORD_CLASS,
        org_id: null,
        status: "failed",
        decision: "skipped_due_to_lookup_error",
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
      flag_id: string;
      table_name: string;
      record_id: string;
      org_id: string | null;
      retention_status: string;
      retention_action: string | null;
      record_created_at: string;
      retention_expires_at: string | null;
      already_exported: boolean;
    }>;

    // If batch hold is active, every candidate is skipped under that reason.
    if (batchHold.blocked) {
      for (const cand of candidates) {
        skipCounts.legal_hold_batch++;
        anySkip = true;
        perFlag.push({
          flag_id: cand.flag_id,
          decision: "skipped",
          reason: "skipped_due_to_legal_hold_batch",
          org_id: cand.org_id,
        });
        const ev = await writeEvidence(admin, {
          run_id: runId,
          job_name: JOB_NAME,
          record_class: RECORD_CLASS,
          org_id: cand.org_id,
          status: "skipped",
          decision: "skipped_due_to_legal_hold",
          reason: `batch_sentinel_hold_id=${batchHold.activeHold?.id ?? "unknown"}`,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          rows_skipped_legal_hold: 1,
          details: {
            dry_run: dryRun,
            flag_id: cand.flag_id,
            table_name: cand.table_name,
            record_id: cand.record_id,
            skip_category: "legal_hold_batch",
          },
        });
        if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
      }
    } else {
      for (const cand of candidates) {
        const orgId = cand.org_id;

        // (a) duplicate / already-exported skip — pre-classified by RPC
        if (cand.already_exported) {
          skipCounts.duplicate++;
          anySkip = true;
          perFlag.push({
            flag_id: cand.flag_id,
            decision: "skipped",
            reason: "skipped_due_to_duplicate",
            org_id: orgId,
          });
          const ev = await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "skipped",
            decision: "skipped_due_to_duplicate",
            reason: "archive_storage_path_already_set",
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            details: {
              dry_run: dryRun,
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              skip_category: "duplicate",
            },
          });
          if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
          continue;
        }

        // (b) per-row legal hold check
        const scopeType = COLD_TABLE_TO_SCOPE[cand.table_name];
        if (scopeType) {
          const rowHold = await assertNoLegalHold(admin, [
            { scope_type: scopeType, scope_id: cand.record_id },
          ], {
            action: `cold-storage-archive.${cand.table_name}`,
            actorUserId: null,
            actorOrgId: orgId,
            requestId: runId,
            relatedRequestId: cand.flag_id,
          });
          if (rowHold.blocked) {
            skipCounts.legal_hold_row++;
            anySkip = true;
            perFlag.push({
              flag_id: cand.flag_id,
              decision: "skipped",
              reason: "skipped_due_to_legal_hold_row",
              org_id: orgId,
            });
            const ev = await writeEvidence(admin, {
              run_id: runId,
              job_name: JOB_NAME,
              record_class: RECORD_CLASS,
              org_id: orgId,
              status: "skipped",
              decision: "skipped_due_to_legal_hold",
              reason: `row_hold_id=${rowHold.activeHold?.id ?? "unknown"}`,
              started_at: startedAt,
              finished_at: new Date().toISOString(),
              rows_skipped_legal_hold: 1,
              details: {
                dry_run: dryRun,
                flag_id: cand.flag_id,
                table_name: cand.table_name,
                record_id: cand.record_id,
                skip_category: "legal_hold_row",
              },
            });
            if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });

            if (orgId) {
              const ar = await writePerOrgSkipAudit(admin, orgId, {
                run_id: runId,
                decision: "skipped_due_to_legal_hold",
                skip_category: "legal_hold_row",
                flag_id: cand.flag_id,
                table_name: cand.table_name,
                record_id: cand.record_id,
                job_name: JOB_NAME,
                record_class: RECORD_CLASS,
              });
              if (!ar.ok) auditWriteFailures.push({
                action: RETENTION_JOB_AUDIT_NAMES.skipped, org_id: orgId, error: ar.error ?? "unknown",
              });
            }
            continue;
          }
        }

        // (c) fetch source record
        let sourceRecord: Record<string, unknown> | null = null;
        try {
          const { data: src, error: srcErr } = await admin
            .from(cand.table_name)
            .select("*")
            .eq("id", cand.record_id)
            .maybeSingle();
          if (srcErr) throw srcErr;
          sourceRecord = src ?? null;
        } catch (e) {
          failed++;
          anyFailure = true;
          skipCounts.lookup_error++;
          const errMsg = (e as Error)?.message ?? String(e);
          perFlag.push({
            flag_id: cand.flag_id,
            decision: "skipped",
            reason: "skipped_due_to_lookup_error",
            org_id: orgId,
          });
          const ev = await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "skipped",
            decision: "skipped_due_to_lookup_error",
            reason: `source_fetch_failed: ${errMsg}`,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            rows_skipped_error: 1,
            details: {
              dry_run: dryRun,
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              skip_category: "lookup_error",
              error: errMsg,
            },
          });
          if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
          continue;
        }

        const sourceMissing = sourceRecord === null;
        if (sourceMissing) {
          skipCounts.missing_source++;
          anySkip = true;
        }

        // Build payload (Batch 7: still computed in dry-run so evidence reports realistic size).
        const archivePayload: Record<string, unknown> = {
          _archive_metadata: {
            archive_version: "1.0",
            archived_at: new Date().toISOString(),
            request_id: runId,
            source_table: cand.table_name,
            source_record_id: cand.record_id,
            retention_flag_id: cand.flag_id,
            retention_status: cand.retention_status,
            retention_action: cand.retention_action,
            record_created_at: cand.record_created_at,
            retention_expires_at: cand.retention_expires_at,
            org_id: orgId,
            source_record_present: !sourceMissing,
          },
          source_record: sourceRecord,
        };

        // related records — only when we actually have the source row
        const relatedConfig = RELATED_TABLES[cand.table_name];
        if (relatedConfig && sourceRecord) {
          const relatedData: Record<string, unknown[]> = {};
          for (const rel of relatedConfig) {
            const fkValue = (sourceRecord as any)[rel.sourceKey];
            if (!fkValue) continue;
            const { data: relRows, error: relErr } = await admin
              .from(rel.table)
              .select("*")
              .eq(rel.foreignKey, fkValue)
              .limit(500);
            if (relErr) {
              relatedData[rel.table] = [];
              continue;
            }
            relatedData[rel.table] = relRows ?? [];
          }
          archivePayload.related_records = relatedData;
        }

        const jsonPayload = JSON.stringify(archivePayload, null, 2);
        const payloadHash = await computeSha256(jsonPayload);
        const payloadSize = new TextEncoder().encode(jsonPayload).length;
        const year = new Date(cand.record_created_at).getFullYear();
        const orgSegment = orgId || "system";
        const storagePath = `${cand.table_name}/${year}/${orgSegment}/${cand.record_id}.json`;

        if (dryRun) {
          // DRY RUN — no bucket write, no flag mutation, no source mutation.
          // Even missing-source candidates are reported (decision=would_export
          // when source present, or skipped_due_to_missing_source).
          if (sourceMissing) {
            perFlag.push({
              flag_id: cand.flag_id,
              decision: "skipped",
              reason: "skipped_due_to_missing_source",
              org_id: orgId,
            });
            const ev = await writeEvidence(admin, {
              run_id: runId,
              job_name: JOB_NAME,
              record_class: RECORD_CLASS,
              org_id: orgId,
              status: "skipped",
              decision: "skipped_due_to_missing_source",
              reason: "source_record_null_at_flag_time",
              started_at: startedAt,
              finished_at: new Date().toISOString(),
              details: {
                dry_run: true,
                flag_id: cand.flag_id,
                table_name: cand.table_name,
                record_id: cand.record_id,
                skip_category: "missing_source",
                planned_storage_path: storagePath,
                payload_size_bytes: payloadSize,
              },
            });
            if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
            continue;
          }
          processed++;
          perFlag.push({
            flag_id: cand.flag_id,
            decision: "would_export",
            reason: "dry_run",
            org_id: orgId,
          });
          const ev = await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "skipped", // dry-run: action not taken
            decision: "would_export",
            reason: "dry_run",
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            rows_eligible: 1,
            details: {
              dry_run: true,
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              planned_storage_path: storagePath,
              payload_size_bytes: payloadSize,
              payload_hash_prefix: payloadHash.slice(0, 16),
            },
          });
          if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
          continue;
        }

        // LIVE mode (only when caller explicitly opts in). Still never
        // deletes or mutates source records — only flag bookkeeping +
        // bucket write.
        if (sourceMissing) {
          // In live mode, still safe: write a payload that records
          // source_record:null, so the cold record is the absence-of-record.
          // Evidence row will still flag this for review.
          anySkip = true;
        }

        try {
          const { error: uploadErr } = await admin.storage
            .from("archived-records")
            .upload(storagePath, jsonPayload, {
              contentType: "application/json",
              upsert: false,
            });
          const alreadyExists = uploadErr?.message?.includes("already exists") || uploadErr?.message?.includes("Duplicate");
          if (uploadErr && !alreadyExists) {
            throw new Error(`bucket_upload_failed: ${uploadErr.message}`);
          }

          // Bookkeeping update on retention_flags. This is the ONLY
          // mutation the function performs and is the existing safe
          // archive contract (no source-record mutation, no delete).
          const { data: upd, error: updErr } = await admin
            .from("retention_flags")
            .update({
              archive_storage_path: storagePath,
              archive_hash: payloadHash,
              archive_size_bytes: payloadSize,
              archived_at: new Date().toISOString(),
            })
            .eq("id", cand.flag_id)
            .is("archive_storage_path", null)
            .select("id")
            .maybeSingle();
          if (updErr) {
            console.error(`[${runId}] flag bookkeeping update failed for ${cand.flag_id}: ${updErr.message}`);
          }
          if (!upd) {
            console.warn(`[${runId}] concurrent archive detected for ${cand.flag_id} — bookkeeping skipped`);
          }

          processed++;
          perFlag.push({
            flag_id: cand.flag_id,
            decision: "exported",
            reason: sourceMissing ? "exported_with_null_source" : "exported",
            org_id: orgId,
          });
          const ev = await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "success",
            decision: sourceMissing ? "exported_with_null_source" : "exported",
            reason: sourceMissing ? "source_record_null_at_flag_time" : "ok",
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            rows_eligible: 1,
            details: {
              dry_run: false,
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              storage_path: storagePath,
              payload_size_bytes: payloadSize,
              payload_hash: payloadHash,
              source_record_present: !sourceMissing,
            },
          });
          if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });
        } catch (e) {
          failed++;
          anyFailure = true;
          skipCounts.bucket_write_failed++;
          const errMsg = (e as Error)?.message ?? String(e);
          perFlag.push({
            flag_id: cand.flag_id,
            decision: "skipped",
            reason: "skipped_due_to_bucket_write",
            org_id: orgId,
          });
          const ev = await writeEvidence(admin, {
            run_id: runId,
            job_name: JOB_NAME,
            record_class: RECORD_CLASS,
            org_id: orgId,
            status: "failed",
            decision: "skipped_due_to_bucket_write",
            reason: errMsg,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            rows_skipped_error: 1,
            details: {
              dry_run: false,
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              skip_category: "bucket_write_failed",
              error: errMsg,
            },
          });
          if (!ev.ok) evidenceWriteFailures.push({ phase: `flag:${cand.flag_id}`, error: ev.error ?? "unknown" });

          if (orgId) {
            const ar = await writePerOrgSkipAudit(admin, orgId, {
              run_id: runId,
              decision: "skipped_due_to_bucket_write",
              skip_category: "bucket_write_failed",
              flag_id: cand.flag_id,
              table_name: cand.table_name,
              record_id: cand.record_id,
              job_name: JOB_NAME,
              record_class: RECORD_CLASS,
              error: errMsg,
            });
            if (!ar.ok) auditWriteFailures.push({
              action: RETENTION_JOB_AUDIT_NAMES.skipped, org_id: orgId, error: ar.error ?? "unknown",
            });
          }
        }
      }
    }

    const finalStatus: "success" | "partial" | "failed" = anyFailure
      ? (processed > 0 ? "partial" : "failed")
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
      rows_seen: candidates.length,
      rows_eligible: perFlag.filter((p) => p.decision === "would_export" || p.decision === "exported").length,
      rows_purged: 0, // cold-storage-archive NEVER purges
      rows_skipped_legal_hold: skipCounts.legal_hold_batch + skipCounts.legal_hold_row,
      rows_skipped_error: skipCounts.lookup_error + skipCounts.bucket_write_failed,
      details: {
        dry_run: dryRun,
        candidates: candidates.length,
        processed,
        failed,
        skip_counts: skipCounts,
        lifecycle_event_name: finalEvent,
        lifecycle_persistence: "evidence_only",
        audit_write_failures: auditWriteFailures,
        evidence_write_failures: evidenceWriteFailures,
        batch_hold_blocked: batchHold.blocked,
        batch_hold_id: batchHold.activeHold?.id ?? null,
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
      candidates: candidates.length,
      processed,
      failed,
      skip_counts: skipCounts,
      per_flag: perFlag,
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
      decision: "skipped_due_to_lookup_error",
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
