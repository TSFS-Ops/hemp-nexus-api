import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { assertNoLegalHold, RECORD_GROUP_IDS, type LegalHoldScopeType } from "../_shared/legal-hold.ts";

const COLD_TABLE_TO_SCOPE: Record<string, LegalHoldScopeType | null> = {
  matches: "match",
  match_documents: "evidence",
  match_events: "match",
  wads: "wad",
  pois: "poi",
  compliance_cases: null,
  screening_results: null,
};

/**
 * Cold Storage Archival Pipeline — Edge Function
 *
 * Reads retention_flags with status 'archived' or 'quarantined' that have NOT
 * yet been exported to cold storage (archive_storage_path IS NULL).
 *
 * For each flagged record:
 *   1. Fetches the full source record (plus related sub-records where applicable)
 *   2. Builds a deterministic JSON archive payload
 *   3. Computes SHA-256 integrity hash
 *   4. Uploads the payload to the `archived-records` storage bucket
 *   5. Updates the retention_flag row with path, hash, and size
 *   6. Writes an audit log entry
 *
 * Designed to run weekly via pg_cron (or on-demand by admin).
 *
 * Safety:
 *   - No record is ever deleted by this function
 *   - Each archive operation is individually try/caught so one failure
 *     does not abort the batch
 *   - Idempotent: if archive_storage_path is already set, the record is skipped
 *   - Optimistic concurrency: UPDATE ... WHERE archive_storage_path IS NULL
 */

const BATCH_SIZE = 50; // conservative to stay within edge function timeout

// Related tables to include when archiving a record from a specific source table
const RELATED_TABLES: Record<string, Array<{
  table: string;
  foreignKey: string;
  sourceKey: string;
}>> = {
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

async function computeSha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // Auth: internal cron key or service role only
    const internalKey = req.headers.get("x-internal-key");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    const authHeader = req.headers.get("authorization") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const isCronKey = expectedKey && internalKey === expectedKey;
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    if (!isCronKey && !isServiceRole) {
      throw new ApiException("UNAUTHORIZED", "This endpoint requires internal or service-role access", 401);
    }

    // Parse options
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";
    const requestedLimit = parseInt(url.searchParams.get("limit") || String(BATCH_SIZE), 10);
    const batchLimit = Math.min(Math.max(requestedLimit, 1), BATCH_SIZE);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fetch retention flags that are enforced but not yet archived to storage
    const { data: pendingFlags, error: fetchErr } = await admin
      .from("retention_flags")
      .select("*")
      .in("retention_status", ["archived", "quarantined"])
      .is("archive_storage_path", null)
      .order("retention_expires_at", { ascending: true })
      .limit(batchLimit);

    if (fetchErr) {
      console.error(`[${requestId}] Failed to fetch pending flags:`, fetchErr.message);
      throw new ApiException("FETCH_FAILED", "Failed to query retention flags", 500);
    }

    if (!pendingFlags || pendingFlags.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          request_id: requestId,
          dry_run: dryRun,
          processed: 0,
          failed: 0,
          message: "No records pending cold storage archival",
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let failed = 0;
    let skippedLegalHold = 0;
    const errors: Array<{ flag_id: string; error: string }> = [];

    // DATA-003: batch-level sentinel hold blocks the whole archive pipeline.
    const batchHold = await assertNoLegalHold(admin, [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.cold_storage_archive },
    ], {
      action: "cold-storage-archive.batch",
      actorUserId: null,
      actorOrgId: null,
      requestId,
    });
    if (batchHold.blocked) {
      return new Response(JSON.stringify({
        success: true,
        request_id: requestId,
        processed: 0,
        failed: 0,
        skipped_legal_hold: pendingFlags.length,
        legal_hold_id: batchHold.activeHold?.id ?? null,
        message: "Cold storage archival blocked by active legal hold",
      }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    }

    for (const flag of pendingFlags) {
      // DATA-003: per-record check. Skip archiving if the underlying
      // entity is under an active legal hold.
      const scopeType = COLD_TABLE_TO_SCOPE[flag.table_name];
      if (scopeType) {
        const rowHold = await assertNoLegalHold(admin, [
          { scope_type: scopeType, scope_id: flag.record_id },
        ], {
          action: `cold-storage-archive.${flag.table_name}`,
          actorUserId: null,
          actorOrgId: flag.org_id ?? null,
          requestId,
          relatedRequestId: flag.id,
        });
        if (rowHold.blocked) {
          skippedLegalHold++;
          continue;
        }
      }
      try {
        // 1. Fetch the source record
        const { data: sourceRecord, error: sourceErr } = await admin
          .from(flag.table_name)
          .select("*")
          .eq("id", flag.record_id)
          .maybeSingle();

        if (sourceErr) {
          throw new Error(`Source fetch failed: ${sourceErr.message}`);
        }

        // Build the archive payload
        const archivePayload: Record<string, unknown> = {
          _archive_metadata: {
            archive_version: "1.0",
            archived_at: new Date().toISOString(),
            request_id: requestId,
            source_table: flag.table_name,
            source_record_id: flag.record_id,
            retention_flag_id: flag.id,
            retention_status: flag.retention_status,
            retention_action: flag.retention_action,
            record_created_at: flag.record_created_at,
            retention_expires_at: flag.retention_expires_at,
            org_id: flag.org_id,
          },
          source_record: sourceRecord, // null if already purged — that's acceptable
        };

        // 2. Fetch related records (if mapping exists)
        const relatedConfig = RELATED_TABLES[flag.table_name];
        if (relatedConfig && sourceRecord) {
          const relatedData: Record<string, unknown[]> = {};

          for (const rel of relatedConfig) {
            const fkValue = sourceRecord[rel.sourceKey];
            if (!fkValue) continue;

            const { data: relRecords, error: relErr } = await admin
              .from(rel.table)
              .select("*")
              .eq(rel.foreignKey, fkValue)
              .limit(500);

            if (relErr) {
              console.warn(
                `[${requestId}] Warning: failed to fetch related ${rel.table} for ${flag.record_id}: ${relErr.message}`
              );
              relatedData[rel.table] = [];
              continue;
            }

            relatedData[rel.table] = relRecords || [];
          }

          archivePayload.related_records = relatedData;
        }

        // 3. Serialize and compute hash
        const jsonPayload = JSON.stringify(archivePayload, null, 2);
        const payloadHash = await computeSha256(jsonPayload);
        const payloadSize = new TextEncoder().encode(jsonPayload).length;

        // 4. Determine storage path
        // Structure: {table_name}/{year}/{org_id_or_system}/{record_id}.json
        const year = new Date(flag.record_created_at).getFullYear();
        const orgSegment = flag.org_id || "system";
        const storagePath = `${flag.table_name}/${year}/${orgSegment}/${flag.record_id}.json`;

        if (dryRun) {
          console.log(
            `[${requestId}] [DRY RUN] Would archive ${flag.table_name}/${flag.record_id} → ${storagePath} (${payloadSize} bytes, hash: ${payloadHash.slice(0, 16)}…)`
          );
          processed++;
          continue;
        }

        // 5. Upload to storage bucket
        const { error: uploadErr } = await admin.storage
          .from("archived-records")
          .upload(storagePath, jsonPayload, {
            contentType: "application/json",
            upsert: false, // fail if duplicate — prevents accidental overwrite
          });

        if (uploadErr) {
          // If the file already exists, treat as idempotent success
          if (uploadErr.message?.includes("already exists") || uploadErr.message?.includes("Duplicate")) {
            console.log(`[${requestId}] Archive already exists at ${storagePath}, updating metadata only`);
          } else {
            throw new Error(`Storage upload failed: ${uploadErr.message}`);
          }
        }

        // 6. Update retention_flags with archive metadata
        // Optimistic concurrency: only update if archive_storage_path is still null
        const { data: updateResult, error: updateErr } = await admin
          .from("retention_flags")
          .update({
            archive_storage_path: storagePath,
            archive_hash: payloadHash,
            archive_size_bytes: payloadSize,
            archived_at: new Date().toISOString(),
          })
          .eq("id", flag.id)
          .is("archive_storage_path", null)
          .select("id")
          .maybeSingle();

        if (updateErr) {
          console.error(`[${requestId}] Metadata update failed for ${flag.id}: ${updateErr.message}`);
          // Storage file was uploaded but metadata not saved — log for reconciliation
          // The next run will skip this record because the file already exists
        }

        if (!updateResult) {
          console.warn(`[${requestId}] Concurrent archive detected for ${flag.id}, skipping metadata update`);
        }

        // 7. Audit log
        await admin
          .from("audit_logs")
          .insert({
            org_id: flag.org_id || "00000000-0000-0000-0000-000000000000",
            action: "retention.cold_storage_archived",
            entity_type: flag.table_name,
            entity_id: flag.record_id,
            metadata: {
              request_id: requestId,
              flag_id: flag.id,
              storage_path: storagePath,
              archive_hash: payloadHash,
              archive_size_bytes: payloadSize,
              retention_status: flag.retention_status,
              source_record_present: sourceRecord !== null,
              related_tables_archived: relatedConfig
                ? relatedConfig.map((r) => r.table)
                : [],
            },
          })
          .then(({ error: auditErr }) => {
            if (auditErr) {
              console.error(`[${requestId}] Audit log failed for ${flag.id}: ${auditErr.message}`);
            }
          });

        processed++;
        console.log(
          `[${requestId}] Archived ${flag.table_name}/${flag.record_id} → ${storagePath} (${payloadSize} bytes)`
        );
      } catch (err) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ flag_id: flag.id, error: errMsg });
        console.error(`[${requestId}] Failed to archive flag ${flag.id}: ${errMsg}`);
      }
    }

    // Summary audit log
    if (!dryRun) {
      await admin
        .from("audit_logs")
        .insert({
          org_id: "00000000-0000-0000-0000-000000000000",
          action: "retention.cold_storage_batch_completed",
          entity_type: "system",
          metadata: {
            request_id: requestId,
            processed,
            failed,
            total_pending: pendingFlags.length,
            errors: errors.slice(0, 10), // cap to prevent bloat
            timestamp: new Date().toISOString(),
          },
        })
        .then(({ error: auditErr }) => {
          if (auditErr) {
            console.error(`[${requestId}] Summary audit log failed: ${auditErr.message}`);
          }
        });
    }

    const summary = {
      success: true,
      request_id: requestId,
      dry_run: dryRun,
      processed,
      failed,
      total_pending: pendingFlags.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      timestamp: new Date().toISOString(),
    };

    console.log(`[${requestId}] Cold storage archival complete:`, JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[${requestId}] Cold storage archival error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
