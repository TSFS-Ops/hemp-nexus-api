/**
 * Batch O — AUD-012 export audit wrapper.
 *
 * Records `export.csv` (or `export.json`) in `audit_logs` BEFORE a
 * sensitive download is delivered to the operator. The browser-side
 * helper invokes a tiny edge function so the row is written with
 * server-trusted actor + IP/UA rather than a client-claimed value.
 *
 * For non-sensitive exports (e.g. plain match list) callers can opt
 * out by simply not invoking this helper. The four sensitive exports
 * wired in Batch O are:
 *   - admin audit_logs CSV
 *   - admin_audit_logs CSV
 *   - outreach blocks CSV (org-level pattern)
 *   - bulk matches CSV with metadata
 */
import { supabase } from "@/integrations/supabase/client";

export interface ExportAuditInput {
  target_type: "audit_logs" | "admin_audit_logs" | "outreach_blocks" | "matches" | "notification_preferences" | "programmes" | "programme_participants" | "programme_fund_flows" | "other";
  format?: "csv" | "json";
  row_count: number;
  filters?: Record<string, unknown>;
  sensitive?: boolean;
  reason?: string;
}

/**
 * Best-effort. Never blocks the download — if the audit write fails
 * we still let the export proceed (the toast surfaces the warning).
 */
export async function recordExportAudit(input: ExportAuditInput): Promise<{ ok: boolean; aal_required?: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("export-audit", {
      body: {
        target_type: input.target_type,
        format: input.format ?? "csv",
        row_count: input.row_count,
        filters: input.filters ?? {},
        sensitive: !!input.sensitive,
        reason: input.reason ?? null,
      },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, aal_required: !!(data as { aal_required?: boolean })?.aal_required };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
