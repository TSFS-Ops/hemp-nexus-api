/**
 * DATA-005 / DATA-010 Phase 2A - Server-side redaction SSOT (client
 * mirror). Authoritative copy: supabase/functions/_shared/export-redaction.ts
 *
 * Two layers:
 *   1. FORBIDDEN_EXPORT_COLUMN_NAMES - column tokens that must never
 *      appear in any export projection, regardless of category.
 *   2. CATEGORY_ALLOW_LISTS - explicit per-category column allow-lists.
 *      Exports MUST be built from these projections - never SELECT *.
 */

export const FORBIDDEN_EXPORT_COLUMN_NAMES: readonly string[] = Object.freeze([
  // passwords / hashes
  "password",
  "password_hash",
  "encrypted_password",
  "password_salt",
  // tokens
  "api_key",
  "api_key_raw",
  "api_key_hash",
  "auth_token",
  "session_token",
  "refresh_token",
  "reset_token",
  "verification_token",
  // webhook secrets
  "webhook_secret",
  "signing_secret",
  // payment card data (defence in depth - we don't store it)
  "card_number",
  "card_cvv",
  "card_cvc",
  "card_expiry",
  "pan",
  // privileged / internal notes
  "admin_notes",
  "privileged_legal_notes",
  "internal_investigation_notes",
  "internal_notes",
  // third-party confidential raw fetches
  "auto_sources_raw",
  "third_party_confidential",
]);

/** Per-category explicit column projection for user_export. */
export const USER_EXPORT_CATEGORY_ALLOW_LISTS: Record<string, readonly string[]> = {
  profile: ["id", "display_name", "email", "org_id", "created_at"],
  org_memberships: ["org_id", "role", "joined_at"],
  notification_prefs: ["user_id", "channel", "category", "enabled", "updated_at"],
  my_trade_requests: [
    "id",
    "org_id",
    "side",
    "commodity",
    "quantity",
    "unit",
    "status",
    "created_at",
  ],
  my_matches: ["id", "trade_request_id", "status", "created_at"],
  my_engagements: ["id", "match_id", "engagement_status", "created_at"],
  my_billing_usage: ["id", "action_type", "amount", "created_at"],
  my_documents: ["id", "match_id", "doc_type", "filename", "created_at"],
};

/** Per-category explicit column projection for admin_export (subset only). */
export const ADMIN_EXPORT_CATEGORY_ALLOW_LISTS: Record<string, readonly string[]> = {
  user_profile: ["id", "display_name", "email", "org_id", "created_at"],
  org_memberships: ["org_id", "user_id", "role", "joined_at"],
  trade_requests: [
    "id",
    "org_id",
    "side",
    "commodity",
    "quantity",
    "unit",
    "status",
    "created_at",
  ],
  matches: ["id", "trade_request_id", "buyer_org_id", "seller_org_id", "status", "created_at"],
  audit_history_summary: ["id", "action", "entity_type", "entity_id", "created_at"],
};

/** Returns true if a candidate column should be stripped under any circumstances. */
export function isForbiddenExportColumn(column: string): boolean {
  const c = column.toLowerCase();
  return FORBIDDEN_EXPORT_COLUMN_NAMES.some(
    (banned) => c === banned || c.includes(banned),
  );
}

/** Defence-in-depth: filter an allow-list to remove anything that matches a forbidden pattern. */
export function safeProjection(allow: readonly string[]): string[] {
  return allow.filter((col) => !isForbiddenExportColumn(col));
}
