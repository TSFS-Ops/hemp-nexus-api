/**
 * Batch O — AUD-012 export audit wrapper.
 * DATA-010 Phase 1 (2026-05-23): `purpose` + `reason` are now required
 * at the helper boundary and validated server-side. Callers that do
 * not have a real reason MUST prompt the operator for one — never
 * silently pass a fake reason.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  type ExportPurpose,
  MIN_EXPORT_REASON_LENGTH,
} from "@/lib/export-purpose";

export interface ExportAuditInput {
  target_type:
    | "audit_logs"
    | "admin_audit_logs"
    | "outreach_blocks"
    | "matches"
    | "notification_preferences"
    | "programmes"
    | "programme_participants"
    | "programme_fund_flows"
    | "other";
  format?: "csv" | "json";
  row_count: number;
  filters?: Record<string, unknown>;
  /** Advisory only — server treats every admin export as sensitive. */
  sensitive?: boolean;
  /** DATA-010 Phase 1: required. */
  purpose: ExportPurpose;
  /** DATA-010 Phase 1: required, min 10 chars. */
  reason: string;
  /** DATA-010 Phase 1: nullable client/org scope. */
  target_org_id?: string | null;
  /** DATA-010 Phase 1: which data categories are exported. */
  data_categories?: string[];
  requested_date_range?: { from?: string; to?: string } | null;
}

export class ExportAuditValidationError extends Error {
  constructor(public readonly field: "purpose" | "reason", message: string) {
    super(message);
    this.name = "ExportAuditValidationError";
  }
}

function validateInput(input: ExportAuditInput): void {
  if (!input.purpose) {
    throw new ExportAuditValidationError("purpose", "Export purpose is required.");
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_EXPORT_REASON_LENGTH) {
    throw new ExportAuditValidationError(
      "reason",
      `Export reason must be at least ${MIN_EXPORT_REASON_LENGTH} characters.`,
    );
  }
}

/**
 * Best-effort. Never blocks the download silently — but throws
 * `ExportAuditValidationError` if purpose/reason are missing so the
 * caller cannot accidentally ship an unaudited export.
 */
export async function recordExportAudit(
  input: ExportAuditInput,
): Promise<{ ok: boolean; aal_required?: boolean; error?: string; export_request_id?: string }> {
  validateInput(input);
  try {
    const { data, error } = await supabase.functions.invoke("export-audit", {
      body: {
        target_type: input.target_type,
        format: input.format ?? "csv",
        row_count: input.row_count,
        filters: input.filters ?? {},
        sensitive: input.sensitive ?? true,
        purpose: input.purpose,
        reason: input.reason.trim(),
        target_org_id: input.target_org_id ?? null,
        data_categories: input.data_categories ?? [],
        requested_date_range: input.requested_date_range ?? null,
      },
    });
    if (error) {
      const status = (error as { context?: { status?: number } })?.context?.status;
      // 403 with code MFA_REQUIRED comes through as a generic error from
      // functions.invoke — surface aal_required when possible.
      const message = error.message ?? "audit write failed";
      const aal = /mfa_required|aal/i.test(message) || status === 403;
      return { ok: false, error: message, aal_required: aal };
    }
    const d = (data ?? {}) as { aal_required?: boolean; export_request_id?: string };
    return { ok: true, aal_required: !!d.aal_required, export_request_id: d.export_request_id };
  } catch (e) {
    if (e instanceof ExportAuditValidationError) throw e;
    return { ok: false, error: (e as Error).message };
  }
}
