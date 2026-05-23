/**
 * File Download Utilities
 *
 * Centralised helpers for generating and downloading files.
 * Replaces duplicated blob/anchor logic across the codebase.
 *
 * Batch O — DATA-005 / AUD-012: also provides `redactExportMetadata`,
 * the single allowlist/redaction helper every CSV/JSON export must use
 * before serialising audit/match/outreach metadata. Anything that looks
 * like a token, secret, api key, payment reference, IP or user-agent is
 * stripped. Use this for any export touching `audit_logs`, payment
 * webhooks, admin actions or other raw metadata blobs.
 */

// Keys we never export — case-insensitive exact match.
const REDACTED_EXACT_KEYS = new Set<string>([
  "actor_ip",
  "ip_address",
  "ip",
  "user_agent",
  "useragent",
  "request_id",
  "x_request_id",
  "payment_reference",
  "authorization_url",
  "access_code",
  "authorization",
  "cookie",
  "set_cookie",
  "session_id",
  "refresh_token",
  "id_token",
  "access_token",
  "bearer",
  "signature",
  "x_signature",
  "webhook_signature",
  "internal_cron_key",
  "service_role_key",
  "service_role",
]);

// Any key ending with these suffixes (lower-cased) is dropped.
const REDACTED_SUFFIXES = ["_token", "_secret", "_key", "_password", "_hash"];

const REDACTED_PLACEHOLDER = "[redacted]";

function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase();
  if (REDACTED_EXACT_KEYS.has(k)) return true;
  if (k === "key" || k === "token" || k === "secret" || k === "password") return true;
  for (const suffix of REDACTED_SUFFIXES) {
    if (k.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Recursively redact secret / PII / internal-context fields from an
 * arbitrary metadata-style object before it leaves the system in a
 * CSV/JSON export. Pass-through for primitives. Arrays are mapped.
 * Cycles are broken by depth limit.
 */
export function redactExportMetadata<T = unknown>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED_PLACEHOLDER as unknown as T;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactExportMetadata(v, depth + 1)) as unknown as T;
  }
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (shouldRedactKey(k)) {
        out[k] = REDACTED_PLACEHOLDER;
        continue;
      }
      out[k] = redactExportMetadata(v, depth + 1);
    }
    return out as unknown as T;
  }
  // Primitives flow through unchanged. We deliberately do not scan
  // string values for opaque tokens — the keying convention is the
  // contract. Add per-call scrubbing if a specific export needs it.
  return value;
}


/**
 * Escape a CSV cell value, handling quotes and special characters
 */
function escapeCSVCell(value: unknown): string {
  const str = String(value ?? '');
  // If contains comma, quote, or newline, wrap in quotes and escape inner quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV content from headers and rows
 */
export function generateCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCSVCell).join(',');
  const dataLines = rows.map(row => row.map(escapeCSVCell).join(','));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Download content as a file
 */
export function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string = 'text/plain'
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up to prevent memory leaks
  URL.revokeObjectURL(url);
}

/**
 * Download data as CSV file
 */
export function downloadCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  filename: string
): void {
  const csv = generateCSV(headers, rows);
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

/**
 * Build the standard CSV preamble that every audited export prepends.
 * Lines are prefixed with `#` so spreadsheet tools can skip them, and
 * carry the same provenance information that gets written to
 * `audit_logs` via `recordExportAudit`. Operators (and auditors) must
 * be able to glance at the file and see when it was generated, what
 * filters were applied, and how many rows it contains.
 */
export function buildExportPreamble(opts: {
  reportName: string;
  rowCount: number;
  filters?: Record<string, unknown>;
  generatedAt?: string;
}): string[] {
  return [
    `# report: ${opts.reportName}`,
    `# generated_at: ${opts.generatedAt ?? new Date().toISOString()}`,
    `# row_count: ${opts.rowCount}`,
    `# filters: ${opts.filters ? JSON.stringify(opts.filters) : "{}"}`,
  ];
}

/**
 * Batch T — AUD-017: audited CSV download.
 *
 * Single entry point every sensitive CSV export in the app must use.
 *  1. Calls `recordExportAudit` BEFORE any bytes leave the browser, so the
 *     server-side `audit_logs` row is written with trusted actor + IP/UA.
 *  2. If the export is declared `sensitive` and the audit edge function
 *     responds with `aal_required: true`, the download is blocked and the
 *     caller surfaces an MFA-required toast. Non-sensitive exports
 *     proceed even when the audit write itself errored (best-effort).
 *  3. Prepends a `# generated_at` / `# report` / `# filters` preamble so
 *     a downloaded file can never be mistaken for live data.
 */
export interface AuditedExportOptions {
  reportName: string;
  filename: string;
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
  sensitive?: boolean;
  filters?: Record<string, unknown>;
  /** DATA-010 Phase 1: required. */
  purpose: import("./export-purpose").ExportPurpose;
  /** DATA-010 Phase 1: required, min 10 chars. */
  reason: string;
  /** DATA-010 Phase 1: nullable client/org scope. */
  target_org_id?: string | null;
  /** DATA-010 Phase 1: which data categories are exported. */
  data_categories?: string[];
}

export async function auditedDownloadCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  options: AuditedExportOptions,
): Promise<{ ok: boolean; aal_required?: boolean; error?: string }> {
  // Lazy-import to keep this module free of supabase-client cycles in tests
  // that import download-utils in isolation.
  const { recordExportAudit } = await import("@/lib/export-audit");
  const audit = await recordExportAudit({
    target_type: options.target_type,
    format: "csv",
    row_count: rows.length,
    filters: options.filters,
    sensitive: !!options.sensitive,
    purpose: options.purpose,
    reason: options.reason,
    target_org_id: options.target_org_id ?? null,
    data_categories: options.data_categories ?? [options.target_type],
  });

  if (options.sensitive && audit.aal_required) {
    return { ok: false, aal_required: true };
  }
  if (!audit.ok && options.sensitive) {
    return { ok: false, error: audit.error };
  }

  const preamble = buildExportPreamble({
    reportName: options.reportName,
    rowCount: rows.length,
    filters: options.filters,
  });
  const csv = [...preamble, generateCSV(headers, rows)].join("\n");
  downloadFile(csv, options.filename, "text/csv;charset=utf-8;");
  return { ok: true };
}

/**
 * Audited variant for callers that have already serialised their CSV
 * body (multi-section reports, BOM-prefixed exports, custom delimiters).
 */
export async function auditedDownloadCSVRaw(
  body: string,
  options: AuditedExportOptions & { rowCount: number; bom?: boolean },
): Promise<{ ok: boolean; aal_required?: boolean; error?: string }> {
  const { recordExportAudit } = await import("@/lib/export-audit");
  const audit = await recordExportAudit({
    target_type: options.target_type,
    format: "csv",
    row_count: options.rowCount,
    filters: options.filters,
    sensitive: !!options.sensitive,
    purpose: options.purpose,
    reason: options.reason,
    target_org_id: options.target_org_id ?? null,
    data_categories: options.data_categories ?? [options.target_type],
  });
  if (options.sensitive && audit.aal_required) {
    return { ok: false, aal_required: true };
  }
  if (!audit.ok && options.sensitive) {
    return { ok: false, error: audit.error };
  }
  const preamble = buildExportPreamble({
    reportName: options.reportName,
    rowCount: options.rowCount,
    filters: options.filters,
  });
  const out = [...preamble, body].join("\n");
  downloadFile(
    (options.bom ? "\uFEFF" : "") + out,
    options.filename,
    "text/csv;charset=utf-8;",
  );
  return { ok: true };
}


/**
 * Download data as JSON file
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, filename, 'application/json');
}

/**
 * Generate a timestamped filename
 */
export function timestampedFilename(prefix: string, extension: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `${prefix}-${date}.${extension}`;
}
