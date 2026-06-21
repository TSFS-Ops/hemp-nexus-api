import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { assertNoLegalHold, RECORD_GROUP_IDS, type LegalHoldScopeType } from "../_shared/legal-hold.ts";

// DATA-003: map retention-flag source tables to a hold scope_type so the
// per-record check can refuse enforcement when a hold covers the entity.
const TABLE_TO_SCOPE: Record<string, LegalHoldScopeType | null> = {
  matches: "match",
  match_documents: "evidence",
  match_events: "match",
  wads: "wad",
  pois: "poi",
  compliance_cases: null,
  screening_results: null,
  audit_logs: null,
  collapse_ledger: null,
};

/**
 * Data Retention Enforcement Edge Function
 *
 * Scans key tables for records approaching or exceeding the 7-year retention limit.
 * Phase 1: Flag records and assign retention actions.
 * Phase 2: Enforce assigned actions (archive/quarantine) for expired records.
 *
 * Lifecycle: active → flagged → retained/archived/quarantined → resolved/deleted
 *
 * Designed to be triggered by pg_cron daily.
 *
 * Tables scanned:
 *   - audit_logs
 *   - collapse_ledger
 *   - match_events
 *   - matches
 *   - screening_results
 *   - match_documents
 *   - wads
 *   - compliance_cases
 *
 * Retention actions:
 *   - archive:            Mark as archived, preserve metadata
 *   - quarantine:         Restrict from ordinary UI access
 *   - mark_readonly:      Prevent further mutation
 *   - retain:             Explicitly mark as retained under policy
 *   - schedule_deletion:  Mark for future deletion (never auto-deletes)
 *   - no_action:          Flagged but no enforcement needed
 *
 * Safety:
 *   - No record is ever physically deleted by this function
 *   - Every enforcement is audit-logged
 *   - Duplicate enforcement is prevented via status checks
 *   - Dry-run mode available via ?dry_run=true query param
 */

const RETENTION_YEARS = 7;
const WARNING_DAYS = 90;
const BATCH_SIZE = 200;

// Record-type to default enforcement action mapping
// Conservative: compliance-critical records default to 'archive', not deletion
const DEFAULT_ACTIONS: Record<string, string> = {
  audit_logs: "retain",           // Never delete audit records, mark as retained
  collapse_ledger: "retain",      // Immutable ledger - retain
  match_events: "archive",        // Archive event history
  matches: "archive",             // Archive match records
  screening_results: "archive",   // Archive screening history
  match_documents: "quarantine",  // Restrict document access but preserve
  wads: "archive",                // Archive sealed evidence bundles
  compliance_cases: "retain",     // Retain compliance case history
};

const TABLES_TO_SCAN = [
  { table: "audit_logs", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "collapse_ledger", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "match_events", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "matches", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "screening_results", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "match_documents", dateCol: "uploaded_at", idCol: "id", orgCol: "org_id" },
  { table: "wads", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
  { table: "compliance_cases", dateCol: "created_at", idCol: "id", orgCol: "org_id" },
];

interface ScanResult {
  scanned: number;
  flagged: number;
  expired: number;
  enforced: number;
  skipped_already_actioned: number;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // Auth: cron key or service role only (anon key fallback removed for security)
    const internalKey = req.headers.get("x-internal-key");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    const authHeader = req.headers.get("authorization");

    const isServiceRole = authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___none___");
    const isCronKey = expectedKey && internalKey === expectedKey;

    if (!isServiceRole && !isCronKey) {
      throw new ApiException("UNAUTHORIZED", "Internal access only. Provide x-internal-key header or service-role authorization.", 401);
    }

    // Parse query params
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";
    const enforceExpired = url.searchParams.get("enforce") !== "false"; // default: enforce

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const retentionCutoff = new Date(now);
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - RETENTION_YEARS);

    const warningCutoff = new Date(retentionCutoff);
    warningCutoff.setDate(warningCutoff.getDate() + WARNING_DAYS);

    const results: Record<string, ScanResult> = {};

    for (const { table, dateCol, idCol, orgCol } of TABLES_TO_SCAN) {
      const result: ScanResult = {
        scanned: 0,
        flagged: 0,
        expired: 0,
        enforced: 0,
        skipped_already_actioned: 0,
      };

      // Fetch records within the warning window
      const { data: records, error: scanErr } = await admin
        .from(table)
        .select(`${idCol}, ${dateCol}, ${orgCol}`)
        .lte(dateCol, warningCutoff.toISOString())
        .order(dateCol, { ascending: true })
        .limit(BATCH_SIZE);

      if (scanErr) {
        console.error(`[${requestId}] Error scanning ${table}:`, scanErr);
        results[table] = result;
        continue;
      }

      result.scanned = records?.length || 0;

      for (const record of (records || []) as Array<Record<string, any>>) {
        const createdAt = new Date(record[dateCol]);
        const expiresAt = new Date(createdAt);
        expiresAt.setFullYear(expiresAt.getFullYear() + RETENTION_YEARS);

        const isExpired = expiresAt <= now;
        const flagType = isExpired ? "expired" : "approaching_expiry";
        const defaultAction = DEFAULT_ACTIONS[table] || "archive";

        // Determine retention status
        let retentionStatus: string;
        let retentionAction: string | null = null;

        if (isExpired) {
          retentionStatus = "flagged";
          retentionAction = defaultAction;
          result.expired++;
        } else {
          retentionStatus = "active";
          result.flagged++;
        }

        if (dryRun) continue;

        // Check if already actioned - prevent duplicate enforcement
        const { data: existing } = await admin
          .from("retention_flags")
          .select("id, retention_status, enforcement_applied_at")
          .eq("table_name", table)
          .eq("record_id", record[idCol])
          .maybeSingle();

        if (existing) {
          // Already enforced or resolved - don't re-process
          if (["archived", "quarantined", "retained", "resolved", "deleted", "pending_deletion"].includes(existing.retention_status)) {
            result.skipped_already_actioned++;
            continue;
          }

          // Update flag type and status if changed
          await admin
            .from("retention_flags")
            .update({
              flag_type: flagType,
              retention_status: retentionStatus,
              retention_action: retentionAction,
              last_scan_at: now.toISOString(),
              org_id: record[orgCol] || null,
            })
            .eq("id", existing.id);
        } else {
          // Insert new flag
          await admin
            .from("retention_flags")
            .upsert({
              table_name: table,
              record_id: record[idCol],
              record_created_at: record[dateCol],
              retention_expires_at: expiresAt.toISOString(),
              flag_type: flagType,
              flagged_at: now.toISOString(),
              retention_status: retentionStatus,
              retention_action: retentionAction,
              last_scan_at: now.toISOString(),
              org_id: record[orgCol] || null,
            }, { onConflict: "table_name,record_id" });
        }
      }

      // ── Phase 2: Enforce expired records ──
      if (enforceExpired && !dryRun) {
        const { data: dueRecords } = await admin
          .from("retention_flags")
          .select("*")
          .eq("table_name", table)
          .eq("retention_status", "flagged")
          .not("retention_action", "is", null)
          .lte("retention_expires_at", now.toISOString())
          .limit(BATCH_SIZE);

        // DATA-003: refuse the whole batch if a record_group-level hold
        // covers the retention pipeline. Per-record checks happen below.
        const batchHold = await assertNoLegalHold(admin, [
          { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.retention_enforcement },
        ], {
          action: `data-retention.enforce.${table}`,
          actorUserId: null,
          actorOrgId: null,
          requestId,
        });
        if (batchHold.blocked) {
          console.log(`[${requestId}] retention enforcement on ${table} blocked by legal hold ${batchHold.activeHold?.id}`);
          continue;
        }

        for (const flag of dueRecords || []) {
          // DATA-003: per-record legal hold check before mutation.
          const scopeType = TABLE_TO_SCOPE[flag.table_name];
          if (scopeType) {
            const rowHold = await assertNoLegalHold(admin, [
              { scope_type: scopeType, scope_id: flag.record_id },
            ], {
              action: `data-retention.enforce.${flag.table_name}`,
              actorUserId: null,
              actorOrgId: flag.org_id ?? null,
              requestId,
              relatedRequestId: flag.id,
            });
            if (rowHold.blocked) {
              result.skipped_already_actioned++;
              continue;
            }
          }
          const action = flag.retention_action;
          let newStatus: string;


          switch (action) {
            case "archive":
              newStatus = "archived";
              break;
            case "quarantine":
              newStatus = "quarantined";
              break;
            case "retain":
              newStatus = "retained";
              break;
            case "mark_readonly":
              newStatus = "retained";
              break;
            case "schedule_deletion":
              newStatus = "pending_deletion";
              break;
            case "no_action":
              newStatus = "resolved";
              break;
            default:
              newStatus = "archived";
          }

          // Apply enforcement
          const { error: enforceErr } = await admin
            .from("retention_flags")
            .update({
              retention_status: newStatus,
              enforcement_applied_at: now.toISOString(),
              archived_at: ["archived", "quarantined"].includes(newStatus) ? now.toISOString() : null,
            })
            .eq("id", flag.id)
            .eq("retention_status", "flagged"); // Optimistic concurrency guard

          if (enforceErr) {
            console.error(`[${requestId}] Enforcement error for ${flag.id}:`, enforceErr);
            continue;
          }

          // Audit log for enforcement
          try {
            await admin.from("audit_logs").insert({
              org_id: flag.org_id || "00000000-0000-0000-0000-000000000000",
              action: `retention.enforced.${action}`,
              entity_type: flag.table_name,
              entity_id: flag.record_id,
              metadata: {
                request_id: requestId,
                retention_action: action,
                new_status: newStatus,
                record_created_at: flag.record_created_at,
                retention_expires_at: flag.retention_expires_at,
                retention_years: RETENTION_YEARS,
              },
            });
          } catch (e: unknown) {
            console.error(`[${requestId}] Audit log error:`, e);
          }

          result.enforced++;
        }
      }

      results[table] = result;
    }

    // Summary audit log
    const totalFlagged = Object.values(results).reduce((s, r) => s + r.flagged, 0);
    const totalExpired = Object.values(results).reduce((s, r) => s + r.expired, 0);
    const totalEnforced = Object.values(results).reduce((s, r) => s + r.enforced, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped_already_actioned, 0);

    if (!dryRun) {
      try {
        await admin.from("audit_logs").insert({
          org_id: "00000000-0000-0000-0000-000000000000",
          action: "retention.scan.completed",
          entity_type: "system",
          metadata: {
            request_id: requestId,
            dry_run: dryRun,
            enforce_expired: enforceExpired,
            results,
            retention_years: RETENTION_YEARS,
            warning_days: WARNING_DAYS,
            scanned_at: now.toISOString(),
            summary: { totalFlagged, totalExpired, totalEnforced, totalSkipped },
          },
        });
      } catch (e: unknown) {
        console.error(`[${requestId}] Summary audit error:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        dry_run: dryRun,
        enforce_expired: enforceExpired,
        scanned_at: now.toISOString(),
        retention_policy: { years: RETENTION_YEARS, warning_days: WARNING_DAYS },
        summary: {
          total_flagged: totalFlagged,
          total_expired: totalExpired,
          total_enforced: totalEnforced,
          total_skipped: totalSkipped,
        },
        tables: results,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Data retention error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
