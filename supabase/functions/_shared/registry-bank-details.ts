/**
 * Batch 4 — M006 / M007 Bank Detail SSOT (Deno mirror).
 * Mirror of src/lib/registry-bank-details.ts. Do not drift.
 */

export const REGISTRY_BANK_DETAIL_STATES = [
  "not_provided",
  "captured_unverified",
  "verification_pending",
  "verified",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "provider_unavailable",
  "cancelled",
] as const;
export type RegistryBankDetailState = (typeof REGISTRY_BANK_DETAIL_STATES)[number];

export const REGISTRY_BANK_DETAIL_VERIFIED_STATE: RegistryBankDetailState = "verified";

export const REGISTRY_BANK_DETAIL_NOT_VERIFIED_STATES: RegistryBankDetailState[] = [
  "not_provided",
  "captured_unverified",
  "verification_pending",
  "failed",
  "expired",
  "revoked",
  "disputed",
  "provider_unavailable",
  "cancelled",
];

export const REGISTRY_BANK_DETAIL_CONSENT_SCOPES = [
  "internal_verification",
  "institutional_status_response",
  "named_bank_confirmation_use",
  "audit_retention",
  "re_verification",
  "dispute_handling",
] as const;
export type RegistryBankDetailConsentScope =
  (typeof REGISTRY_BANK_DETAIL_CONSENT_SCOPES)[number];

export const REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES = [
  "registry_bank_detail_capture_started",
  "registry_bank_detail_submitted",
  "registry_bank_detail_consent_recorded",
  "registry_bank_detail_status_changed",
  "registry_bank_detail_masked_viewed",
  "registry_bank_detail_unmasked_access_requested",
  "registry_bank_detail_unmasked_viewed",
  "registry_bank_detail_revoked",
  "registry_bank_detail_disputed",
] as const;

export const REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY =
  "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry.";

export function isBankDetailVerified(s: RegistryBankDetailState): boolean {
  return s === REGISTRY_BANK_DETAIL_VERIFIED_STATE;
}

export function maskAccountToken(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = String(raw).replace(/\s+/g, "");
  if (trimmed.length <= 4) return "•••• " + trimmed;
  return "•••• " + trimmed.slice(-4);
}

/** Lightweight reversible obfuscation for stored sensitive fields.
 *  NOT a substitute for KMS — flagged as Batch 4 shell-grade until M008+ wires KMS.
 *  Edge functions read raw via service_role; the obfuscation prevents an accidental
 *  log-line leak from being readable verbatim. */
export function obfuscate(raw: string): string {
  return "b64:" + btoa(unescape(encodeURIComponent(raw)));
}
export function deobfuscate(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith("b64:")) return stored;
  try { return decodeURIComponent(escape(atob(stored.slice(4)))); } catch { return ""; }
}
