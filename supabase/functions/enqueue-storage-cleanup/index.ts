import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

/**
 * enqueue-storage-cleanup — Batch E SEC-012 safety net
 *
 * Called by the SPA when a storage upload SUCCEEDED but the follow-up
 * finaliser call FAILED with a session-dead code (REFRESH_FAILED,
 * NO_SESSION, UNAUTHORIZED) — the user cannot complete the document
 * registration so the storage object would otherwise leak until the
 * 24 h sweeper.
 *
 * This endpoint runs unauthenticated (verify_jwt = false) because by
 * construction the caller's session is dead. To stay safe it:
 *   1. Allowlists the bucket (match-documents, governance-docs target the
 *      same bucket today, match-challenge-evidence, kyc-documents).
 *   2. Refuses to enqueue any path that already has a DB row in any of
 *      the recognised tables — i.e. we only ever schedule deletion of
 *      true orphans. A row appearing later (race) is fine: the sweeper
 *      itself rechecks before removing.
 *   3. Schedules deletion via the existing storage_deletion_queue with
 *      scheduled_for = now() + 5 minutes so the next sweeper run picks
 *      it up promptly rather than after 24 h.
 *
 * Failure is non-fatal for the caller — surface as a best-effort path.
 */

const BodySchema = z.object({
  bucket: z.enum(["match-documents", "match-challenge-evidence", "kyc-documents"]),
  file_path: z.string().min(3).max(1200),
  reason: z.string().max(120).optional(),
});

const RECONCILERS: Record<string, Array<{ table: string; column: string }>> = {
  "match-documents": [
    { table: "match_documents", column: "storage_path" },
    { table: "governance_documents", column: "document_path" },
  ],
  "match-challenge-evidence": [
    { table: "match_challenge_evidence", column: "storage_path" },
  ],
  "kyc-documents": [
    { table: "kyc_documents", column: "storage_path" },
  ],
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "validation_error", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const { bucket, file_path, reason } = parsed.data;

    if (file_path.includes("..") || file_path.startsWith("/")) {
      return new Response(JSON.stringify({ error: "invalid_path" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Refuse to enqueue paths that already have a DB row — only orphans
    // may be scheduled.
    for (const r of RECONCILERS[bucket] ?? []) {
      const { count } = await admin
        .from(r.table)
        .select("id", { count: "exact", head: true })
        .eq(r.column, file_path);
      if ((count ?? 0) > 0) {
        return new Response(JSON.stringify({
          ok: false,
          skipped: "has_db_row",
          table: r.table,
          request_id: requestId,
        }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      }
    }

    // De-dupe against the queue itself.
    const { count: existing } = await admin
      .from("storage_deletion_queue")
      .select("id", { count: "exact", head: true })
      .eq("bucket_id", bucket)
      .eq("file_path", file_path);
    if ((existing ?? 0) > 0) {
      return new Response(JSON.stringify({
        ok: true, deduped: true, request_id: requestId,
      }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    }

    // 5-minute scheduled_for so the sweeper picks it up next run.
    const scheduledFor = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: insErr } = await admin
      .from("storage_deletion_queue")
      .insert({
        bucket_id: bucket,
        file_path,
        source_table: RECONCILERS[bucket]?.[0]?.table ?? "match_documents",
        scheduled_for: scheduledFor,
        status: "pending",
        error_message: reason ? `enqueue-storage-cleanup: ${reason}` : null,
      });
    if (insErr) {
      return new Response(JSON.stringify({ ok: false, error: insErr.message, request_id: requestId }), {
        status: 500, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    await admin.from("admin_audit_logs").insert({
      admin_user_id: "00000000-0000-0000-0000-000000000000",
      action: "storage.enqueue_cleanup",
      target_type: "storage_object",
      details: { request_id: requestId, bucket, file_path, reason: reason ?? null, scheduled_for: scheduledFor },
    });

    return new Response(JSON.stringify({ ok: true, enqueued: true, scheduled_for: scheduledFor, request_id: requestId }), {
      status: 200, headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, request_id: requestId }), {
      status: 500, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
