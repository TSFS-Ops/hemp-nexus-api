/**
 * P010 — Stub Provider Labelling / Hiding (edge SSOT).
 *
 * Mirrored at `src/lib/stub-providers.ts`. The two files MUST stay in sync;
 * `scripts/check-stub-providers-parity.mjs` enforces this at prebuild.
 */

export const STUB_PROVIDERS = [
  { key: "cipc", display: "CIPC", domain: "idv" },
  { key: "onfido", display: "Onfido", domain: "idv" },
  { key: "dow_jones", display: "Dow Jones", domain: "sanctions" },
  { key: "refinitiv", display: "Refinitiv", domain: "sanctions" },
] as const;

export type StubProviderKey = (typeof STUB_PROVIDERS)[number]["key"];

export const STUB_PROVIDER_KEYS: readonly string[] = STUB_PROVIDERS.map((p) => p.key);

export function isStubProvider(name: string | null | undefined): boolean {
  if (!name) return false;
  return STUB_PROVIDER_KEYS.includes(name.toLowerCase().trim());
}

export const STUB_PROVIDER_STATUS = {
  STUB_NOT_LIVE: "stub_not_live",
  NO_EXTERNAL_CHECK: "no_external_check",
  PROVIDER_NOT_CONNECTED: "provider_not_connected",
} as const;

export const FORBIDDEN_STUB_RESULT_WORDS = [
  "verified",
  "cleared",
  "passed",
  "approved",
  "screened",
  "complete",
] as const;

export const STUB_PROVIDER_AUDIT = {
  NOT_LIVE: "stub_provider.not_live",
  BLOCKED: "stub_provider.blocked",
  NO_EXTERNAL_CHECK: "stub_provider.no_external_check",
} as const;

export const STUB_PROVIDER_LABEL_SHORT =
  "Not live yet — no external provider check is performed.";

export const STUB_PROVIDER_LABEL_LONG =
  "This provider is not connected yet. No real external verification, screening, or clearance is performed.";

export const STUB_PROVIDER_ERROR_CODE = "STUB_PROVIDER_NOT_LIVE";

/**
 * Build the canonical envelope returned when a request asks for a stub provider.
 * No verification result is created; the case/entity is NOT advanced.
 */
export function buildStubProviderNotLiveEnvelope(provider: string, requestId: string) {
  return {
    success: false,
    error: STUB_PROVIDER_ERROR_CODE,
    provider,
    status: STUB_PROVIDER_STATUS.STUB_NOT_LIVE,
    message: STUB_PROVIDER_LABEL_LONG,
    requestId,
  };
}
