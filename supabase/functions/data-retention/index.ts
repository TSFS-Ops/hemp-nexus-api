import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";

/**
 * Data Retention Enforcement Edge Function
 *
 * Scans key tables for records approaching the 7-year retention limit
 * and flags them in the retention_flags table.
 *
 * Designed to be triggered by pg_cron daily.
 *
 * Tables scanned:
 *   - audit_logs
 *   - collapse_ledger
 *   - match_events
 *   - matches
 *   - screening_results
 *
 * Flag types:
 *   - "approaching_expiry" — record is within 90 days of 7-year mark
 *   - "expired" — record has passed the 7-year retention period
 */

const RETENTION_YEARS = 7;
const WARNING_DAYS = 90;

const TABLES_TO_SCAN = [
  { table: "audit_logs", dateCol: "created_at", idCol: "id" },
  { table: "collapse_ledger", dateCol: "created_at", idCol: "id" },
  { table: "match_events", dateCol: "created_at", idCol: "id" },
  { table: "matches", dateCol: "created_at", idCol: "id" },
  { table: "screening_results", dateCol: "created_at", idCol: "id" },
];

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // Allow cron key or service role
    const internalKey = req.headers.get("x-internal-key");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    const authHeader = req.headers.get("authorization");

    const isServiceRole = authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___none___");
    const isCronKey = expectedKey && internalKey === expectedKey;

    if (!isServiceRole && !isCronKey) {
      // Also allow anon key for pg_cron invocations
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const isAnon = authHeader?.includes(anonKey || "___none___");
      if (!isAnon) {
        throw new ApiException("UNAUTHORIZED", "This endpoint requires internal or service-role access", 401);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const retentionCutoff = new Date(now);
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - RETENTION_YEARS);

    const warningCutoff = new Date(retentionCutoff);
    warningCutoff.setDate(warningCutoff.getDate() + WARNING_DAYS);

    const results: Record<string, { scanned: number; flagged: number; expired: number }> = {};

    for (const { table, dateCol, idCol } of TABLES_TO_SCAN) {
      let flagged = 0;
      let expired = 0;

      // Find records approaching expiry (created between retentionCutoff and warningCutoff)
      const { data: approachingRecords, error: approachErr } = await admin
        .from(table)
        .select(`${idCol}, ${dateCol}`)
        .lte(dateCol, warningCutoff.toISOString())
        .order(dateCol, { ascending: true })
        .limit(500);

      if (approachErr) {
        console.error(`Error scanning ${table}:`, approachErr);
        results[table] = { scanned: 0, flagged: 0, expired: 0 };
        continue;
      }

      const records = approachingRecords || [];

      for (const record of records) {
        const createdAt = new Date(record[dateCol]);
        const expiresAt = new Date(createdAt);
        expiresAt.setFullYear(expiresAt.getFullYear() + RETENTION_YEARS);

        const isExpired = expiresAt <= now;
        const flagType = isExpired ? "expired" : "approaching_expiry";

        const { error: upsertErr } = await admin
          .from("retention_flags")
          .upsert({
            table_name: table,
            record_id: record[idCol],
            record_created_at: record[dateCol],
            retention_expires_at: expiresAt.toISOString(),
            flag_type: flagType,
            flagged_at: now.toISOString(),
          }, { onConflict: "table_name,record_id" });

        if (!upsertErr) {
          if (isExpired) expired++;
          else flagged++;
        }
      }

      results[table] = { scanned: records.length, flagged, expired };
    }

    // Audit log
    await admin.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "retention.scan.completed",
      entity_type: "system",
      metadata: {
        request_id: requestId,
        results,
        retention_years: RETENTION_YEARS,
        warning_days: WARNING_DAYS,
        scanned_at: now.toISOString(),
      },
    }).then(() => {}).catch((e) => console.error("Audit log error:", e));

    const totalFlagged = Object.values(results).reduce((s, r) => s + r.flagged, 0);
    const totalExpired = Object.values(results).reduce((s, r) => s + r.expired, 0);

    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        scanned_at: now.toISOString(),
        retention_policy: { years: RETENTION_YEARS, warning_days: WARNING_DAYS },
        summary: { total_flagged: totalFlagged, total_expired: totalExpired },
        tables: results,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Data retention error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
