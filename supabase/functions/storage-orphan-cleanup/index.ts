import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";

/**
 * Storage Orphan Cleanup
 * 
 * Scans storage buckets for files that have no corresponding database record
 * in match_documents or governance_docs tables. Files older than 24 hours
 * without a DB reference are considered orphans and are deleted.
 * 
 * Designed to run as a scheduled cron job (e.g., daily at 03:00 UTC).
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const buckets = ["match-documents", "governance-docs", "kyc-documents"];
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let totalOrphans = 0;
    let totalDeleted = 0;
    const errors: string[] = [];

    for (const bucket of buckets) {
      try {
        // List all files in the bucket (top-level folders = org IDs)
        const { data: folders, error: listError } = await adminClient.storage
          .from(bucket)
          .list("", { limit: 1000 });

        if (listError) {
          errors.push(`${bucket}: ${listError.message}`);
          continue;
        }

        if (!folders || folders.length === 0) continue;

        for (const folder of folders) {
          if (!folder.id) continue; // skip if not a real folder

          // List files inside each org folder
          const { data: files, error: filesError } = await adminClient.storage
            .from(bucket)
            .list(folder.name, { limit: 1000 });

          if (filesError || !files) continue;

          for (const file of files) {
            if (!file.id || !file.created_at) continue;

            const fileCreated = new Date(file.created_at);
            if (fileCreated > cutoffDate) continue; // Too recent, skip

            const storagePath = `${folder.name}/${file.name}`;

            // Check if this file has a corresponding DB record
            let hasRecord = false;

            if (bucket === "match-documents") {
              const { count } = await adminClient
                .from("match_documents")
                .select("id", { count: "exact", head: true })
                .eq("storage_path", storagePath);
              hasRecord = (count ?? 0) > 0;
            } else if (bucket === "governance-docs") {
              const { count } = await adminClient
                .from("governance_docs")
                .select("id", { count: "exact", head: true })
                .eq("storage_path", storagePath);
              hasRecord = (count ?? 0) > 0;
            } else if (bucket === "kyc-documents") {
              const { count } = await adminClient
                .from("kyc_documents")
                .select("id", { count: "exact", head: true })
                .eq("storage_path", storagePath);
              hasRecord = (count ?? 0) > 0;
            }

            if (!hasRecord) {
              totalOrphans++;

              // Also check the storage_deletion_queue to avoid double-processing
              const { count: queueCount } = await adminClient
                .from("storage_deletion_queue")
                .select("id", { count: "exact", head: true })
                .eq("bucket_id", bucket)
                .eq("file_path", storagePath);

              if ((queueCount ?? 0) > 0) continue; // Already queued for deletion

              // Delete the orphan file
              const { error: deleteError } = await adminClient.storage
                .from(bucket)
                .remove([storagePath]);

              if (deleteError) {
                errors.push(`Delete failed: ${bucket}/${storagePath}: ${deleteError.message}`);
              } else {
                totalDeleted++;
              }
            }
          }
        }
      } catch (bucketError) {
        errors.push(`${bucket}: ${(bucketError as Error).message}`);
      }
    }

    // Log the cleanup run
    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: "00000000-0000-0000-0000-000000000000", // system actor
      action: "storage.orphan_cleanup",
      target_type: "system",
      details: {
        request_id: requestId,
        orphans_found: totalOrphans,
        files_deleted: totalDeleted,
        errors: errors.length > 0 ? errors : undefined,
        buckets_scanned: buckets,
        cutoff_date: cutoffDate.toISOString(),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      orphans_found: totalOrphans,
      files_deleted: totalDeleted,
      errors: errors.length > 0 ? errors : undefined,
      request_id: requestId,
    }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${requestId}] Orphan cleanup error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
