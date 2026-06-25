/**
 * P-5 Batch 3 — Stage 2 funder visibility rules (pure TS).
 *
 * Default-deny: any field not explicitly released is hidden.
 */

export const P5B3_FUNDER_ALLOWED_RELEASED_FIELDS = [
  "transaction_summary",
  "released_evidence_pack_url",
  "released_evidence_pack_version",
  "released_pack_sha256",
  "admin_released_notes",
  "outcome_history",
  "request_thread_public",
  "counterparty_display_name",
  "jurisdiction_summary",
  "provider_safe_status_label",
] as const;
export type P5B3AllowedReleasedField =
  (typeof P5B3_FUNDER_ALLOWED_RELEASED_FIELDS)[number];

export const P5B3_FUNDER_BLOCKED_FIELDS = [
  "raw_documents",
  "raw_bank_account_number",
  "raw_iban",
  "raw_id_number",
  "raw_passport_number",
  "raw_ubo_details",
  "admin_internal_notes",
  "reviewer_note_internal",
  "fraud_flag",
  "provider_raw_response",
  "provider_test_data",
  "other_funder_status",
  "other_funder_notes",
  "other_funder_requests",
] as const;
export type P5B3BlockedField = (typeof P5B3_FUNDER_BLOCKED_FIELDS)[number];

export function isFieldVisibleToFunder(field: string): boolean {
  if ((P5B3_FUNDER_BLOCKED_FIELDS as readonly string[]).includes(field)) return false;
  return (P5B3_FUNDER_ALLOWED_RELEASED_FIELDS as readonly string[]).includes(field);
}

export function applyFunderVisibility<T extends Record<string, unknown>>(
  record: T,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(record)) {
    if (isFieldVisibleToFunder(k)) out[k] = record[k];
  }
  return out as Partial<T>;
}

/** Banking always masked by default for funder surfaces. */
export function maskBankAccount(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}
