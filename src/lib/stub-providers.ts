/**
 * P010 — Stub Provider Labelling / Hiding (browser SSOT).
 *
 * Mirrored at `supabase/functions/_shared/stub-providers.ts`. The two files MUST
 * stay in sync; `scripts/check-stub-providers-parity.mjs` enforces this at prebuild.
 *
 * Policy (P010, accepted by client 2026-06-19):
 *   - CIPC, Onfido, Dow Jones, and Refinitiv are NOT live yet.
 *   - They MUST NOT execute any real external check.
 *   - Client-facing surfaces MUST NOT name them.
 *   - Internal/admin surfaces MAY name them, but only with the approved
 *     "not live yet" label and a disabled control.
 *   - No stub result may use the words: verified, cleared, passed, approved,
 *     screened, complete.
 *   - Even Test Mode MUST NOT make a stub provider look live.
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

/** Internal status values allowed when an internal user touches a stub provider. */
export const STUB_PROVIDER_STATUS = {
  STUB_NOT_LIVE: "stub_not_live",
  NO_EXTERNAL_CHECK: "no_external_check",
  PROVIDER_NOT_CONNECTED: "provider_not_connected",
} as const;

/** Words that MUST NEVER appear in a stub-provider result envelope. */
export const FORBIDDEN_STUB_RESULT_WORDS = [
  "verified",
  "cleared",
  "passed",
  "approved",
  "screened",
  "complete",
] as const;

/** Canonical audit names for P010 events. */
export const STUB_PROVIDER_AUDIT = {
  NOT_LIVE: "stub_provider.not_live",
  BLOCKED: "stub_provider.blocked",
  NO_EXTERNAL_CHECK: "stub_provider.no_external_check",
} as const;

/** Approved labels (verbatim). Do not soften. */
export const STUB_PROVIDER_LABEL_SHORT =
  "Not live yet — no external provider check is performed.";

export const STUB_PROVIDER_LABEL_LONG =
  "This provider is not connected yet. No real external verification, screening, or clearance is performed.";

/** Approved error code returned by edge functions when a stub provider is selected. */
export const STUB_PROVIDER_ERROR_CODE = "STUB_PROVIDER_NOT_LIVE";
