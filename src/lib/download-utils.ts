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
