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

/**
 * Authenticated encryption for sensitive bank-detail fields.
 *
 * Uses AES-256-GCM. The key is loaded from the `BANK_DETAIL_ENCRYPTION_KEY`
 * env var (base64 of 32 raw bytes). If unset, `encryptSensitive` throws so
 * new writes cannot fall back to plaintext.
 *
 * Stored format: `enc:v1:<base64(iv|ciphertext|tag)>` where iv is 12 bytes.
 *
 * Legacy `b64:` rows written before KMS-grade encryption are still readable
 * via `decryptSensitive` for backwards compatibility only; they must be
 * re-encrypted on next update.
 */

const ENC_PREFIX = "enc:v1:";
const LEGACY_PREFIX = "b64:";

let cachedKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = (globalThis as any).Deno?.env?.get?.("BANK_DETAIL_ENCRYPTION_KEY");
  if (!raw) {
    throw new Error(
      "BANK_DETAIL_ENCRYPTION_KEY is not configured. Generate 32 random bytes and store as base64.",
    );
  }
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error("BANK_DETAIL_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Encrypt a UTF-8 plaintext with AES-256-GCM. Returns `enc:v1:...`. */
export async function encryptSensitive(raw: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(raw);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return ENC_PREFIX + b64encode(out);
}

/**
 * Decrypt a stored ciphertext. Supports legacy `b64:` values for read-side
 * backwards compatibility only. Returns "" on any decode/decrypt failure.
 */
export async function decryptSensitive(stored: string | null | undefined): Promise<string> {
  if (!stored) return "";
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const key = await getEncryptionKey();
      const buf = b64decode(stored.slice(ENC_PREFIX.length));
      if (buf.length < 13) return "";
      const iv = buf.slice(0, 12);
      const ct = buf.slice(12);
      const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return new TextDecoder().decode(ptBuf);
    } catch {
      return "";
    }
  }
  if (stored.startsWith(LEGACY_PREFIX)) {
    try {
      return decodeURIComponent(escape(atob(stored.slice(LEGACY_PREFIX.length))));
    } catch {
      return "";
    }
  }
  return stored;
}

/**
 * @deprecated Reversible Base64 provided zero confidentiality. Use
 * {@link encryptSensitive} (AES-256-GCM) for all new writes. Retained as an
 * async shim so any remaining caller behaves identically after `await`.
 */
export async function obfuscate(raw: string): Promise<string> {
  return await encryptSensitive(raw);
}
/**
 * @deprecated Use {@link decryptSensitive}. Retained as async shim.
 */
export async function deobfuscate(stored: string | null | undefined): Promise<string> {
  return await decryptSensitive(stored);
}

