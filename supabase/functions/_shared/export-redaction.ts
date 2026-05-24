/**
 * DATA-005 / DATA-010 Phase 2A — Server-side redaction SSOT (Deno
 * mirror of src/lib/data/export-redaction.ts).
 */

export const FORBIDDEN_EXPORT_COLUMN_NAMES: readonly string[] = Object.freeze([
  "password",
  "password_hash",
  "encrypted_password",
  "password_salt",
  "api_key",
  "api_key_raw",
  "api_key_hash",
  "auth_token",
  "session_token",
  "refresh_token",
  "reset_token",
  "verification_token",
  "webhook_secret",
  "signing_secret",
  "card_number",
  "card_cvv",
  "card_cvc",
  "card_expiry",
  "pan",
  "admin_notes",
  "privileged_legal_notes",
  "internal_investigation_notes",
  "internal_notes",
  "auto_sources_raw",
  "third_party_confidential",
]);

export const USER_EXPORT_CATEGORY_ALLOW_LISTS: Record<string, readonly string[]> = {
  profile: ["id", "display_name", "email", "org_id", "created_at"],
  org_memberships: ["org_id", "role", "joined_at"],
  notification_prefs: ["user_id", "channel", "category", "enabled", "updated_at"],
  my_trade_requests: ["id", "org_id", "side", "commodity", "quantity", "unit", "status", "created_at"],
  my_matches: ["id", "trade_request_id", "status", "created_at"],
  my_engagements: ["id", "match_id", "engagement_status", "created_at"],
  my_billing_usage: ["id", "action_type", "amount", "created_at"],
  my_documents: ["id", "match_id", "doc_type", "filename", "created_at"],
};

export const ADMIN_EXPORT_CATEGORY_ALLOW_LISTS: Record<string, readonly string[]> = {
  user_profile: ["id", "display_name", "email", "org_id", "created_at"],
  org_memberships: ["org_id", "user_id", "role", "joined_at"],
  trade_requests: ["id", "org_id", "side", "commodity", "quantity", "unit", "status", "created_at"],
  matches: ["id", "trade_request_id", "buyer_org_id", "seller_org_id", "status", "created_at"],
  audit_history_summary: ["id", "action", "entity_type", "entity_id", "created_at"],
};

export function isForbiddenExportColumn(column: string): boolean {
  const c = column.toLowerCase();
  return FORBIDDEN_EXPORT_COLUMN_NAMES.some(
    (banned) => c === banned || c.includes(banned),
  );
}

export function safeProjection(allow: readonly string[]): string[] {
  return allow.filter((col) => !isForbiddenExportColumn(col));
}

/** Build a CSV from rows using an explicit allow-list projection. */
export function toCsv(rows: Record<string, unknown>[], columns: readonly string[]): string {
  const safe = safeProjection(columns);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = safe.join(",");
  const body = rows.map((r) => safe.map((c) => escape(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}
