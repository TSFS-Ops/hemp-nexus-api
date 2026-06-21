import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import { assertNoLegalHold, RECORD_GROUP_IDS } from "../_shared/legal-hold.ts";

/**
 * Storage Orphan Cleanup — Batch E hardened
 *
 * Scans known storage buckets for files that have no corresponding DB
 * record. Files older than 24 h without a DB reference are considered
 * orphans and are deleted.
 *
 * Bucket → reconciliation source map:
 *   match-documents          → match_documents.storage_path
 *                              + governance_documents.document_path
 *                              (governance uploads land in the same bucket
 *                              under <org_id>/<match_id>/gov_*.<ext>)
 *   match-challenge-evidence → match_challenge_evidence.storage_path
 *   kyc-documents            → kyc_documents.storage_path
 *
 * Designed to run as a scheduled cron job (e.g. daily at 03:00 UTC) AND
 * to be triggered ad-hoc with a shorter `cutoff_minutes` to pick up
 * session-expiry orphans queued via `enqueue-storage-cleanup`.
 */

type ReconcileFn = (
  admin: ReturnType<typeof createClient>,
  storagePath: string,
) => Promise<boolean>;

interface BucketCfg {
  bucket: string;
  reconcilers: ReconcileFn[];
}

async function existsIn(
  admin: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string,
): Promise<boolean> {
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  return (count ?? 0) > 0;
}

const BUCKETS: BucketCfg[] = [
  {
    bucket: "match-documents",
    reconcilers: [
      (a, p) => existsIn(a, "match_documents", "storage_path", p),
      (a, p) => existsIn(a, "governance_documents", "document_path", p),
    ],
  },
  {
    bucket: "match-challenge-evidence",
    reconcilers: [
      (a, p) => existsIn(a, "match_challenge_evidence", "storage_path", p),
    ],
  },
  {
    bucket: "kyc-documents",
    reconcilers: [
      (a, p) => existsIn(a, "kyc_documents", "storage_path", p),
    ],
  },
];

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    if (!cronKey || providedKey !== cronKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let cutoffMinutes = 24 * 60;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (typeof body?.cutoff_minutes === "number" && body.cutoff_minutes >= 1) {
          cutoffMinutes = Math.min(body.cutoff_minutes, 24 * 60);
        }
      }
    } catch { /* ignore */ }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const cutoffDate = new Date(Date.now() - cutoffMinutes * 60 * 1000);
    let totalOrphans = 0;
    let totalDeleted = 0;
    const errors: string[] = [];

    // Recursive lister — caps each directory at 1000 entries to avoid
    // pathological scans.
    async function listAllFiles(bucket: string, prefix: string): Promise<{ path: string; created_at: string }[]> {
      const { data, error } = await adminClient.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error || !data) {
        if (error) errors.push(`${bucket}:list:${prefix}: ${error.message}`);
        return [];
      }
      const out: { path: string; created_at: string }[] = [];
      for (const entry of data) {
        const subPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        // A storage "folder" placeholder has no id; a file has id + created_at.
        if (entry.id && entry.created_at) {
          out.push({ path: subPath, created_at: entry.created_at });
        } else {
          // It's a folder — recurse one level deeper.
          const nested = await listAllFiles(bucket, subPath);
          out.push(...nested);
        }
      }
      return out;
    }

    // DATA-003: refuse the whole job if a record_group-level hold covers
    // the orphan cleanup pipeline.
    const batchHold = await assertNoLegalHold(adminClient, [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.storage_orphan_cleanup },
    ], {
      action: "storage-orphan-cleanup.batch",
      actorUserId: null,
      actorOrgId: null,
      requestId,
    });
    if (batchHold.blocked) {
      return new Response(JSON.stringify({
        success: true,
        orphans_found: 0,
        files_deleted: 0,
        skipped_legal_hold: true,
        legal_hold_id: batchHold.activeHold?.id ?? null,
        request_id: requestId,
      }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    }

    for (const cfg of BUCKETS) {
      try {
        // List top-level entries then recurse so nested paths like
        // <org>/<match>/poi/<doc>/<file> are reachable.
        const files = await listAllFiles(cfg.bucket, "");
        for (const file of files) {
          if (new Date(file.created_at) > cutoffDate) continue;

          let hasRecord = false;
          for (const fn of cfg.reconcilers) {
            if (await fn(adminClient, file.path)) { hasRecord = true; break; }
          }
          if (hasRecord) continue;

          totalOrphans++;

          const { count: queueCount } = await adminClient
            .from("storage_deletion_queue")
            .select("id", { count: "exact", head: true })
            .eq("bucket_id", cfg.bucket)
            .eq("file_path", file.path);
          if ((queueCount ?? 0) > 0) continue;

          const { error: deleteError } = await adminClient.storage.from(cfg.bucket).remove([file.path]);
          if (deleteError) {
            errors.push(`Delete failed: ${cfg.bucket}/${file.path}: ${deleteError.message}`);
          } else {
            totalDeleted++;
          }
        }
      } catch (bucketError) {
        errors.push(`${cfg.bucket}: ${(bucketError as Error).message}`);
      }
    }

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: "00000000-0000-0000-0000-000000000000",
      action: "storage.orphan_cleanup",
      target_type: "system",
      details: {
        request_id: requestId,
        orphans_found: totalOrphans,
        files_deleted: totalDeleted,
        errors: errors.length > 0 ? errors : undefined,
        buckets_scanned: BUCKETS.map((b) => b.bucket),
        cutoff_date: cutoffDate.toISOString(),
        cutoff_minutes: cutoffMinutes,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      orphans_found: totalOrphans,
      files_deleted: totalDeleted,
      errors: errors.length > 0 ? errors : undefined,
      request_id: requestId,
      buckets_scanned: BUCKETS.map((b) => b.bucket),
      cutoff_minutes: cutoffMinutes,
    }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    console.error(`[${requestId}] Orphan cleanup error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
