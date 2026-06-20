/**
 * P010 — Stub Provider Labelling / Hiding (browser SSOT).
 *
 * Mirrored at `supabase/functions/_shared/stub-providers.ts`. The two files MUST
 * stay in sync; `scripts/check-stub-providers-parity.mjs` enforces this at prebuild.
 *
 * Policy (P010, accepted by client 2026-06-19; hardened 2026-06-20):
 *   - CIPC, Onfido, Dow Jones, and Refinitiv are NOT live yet.
 *   - They MUST NOT execute any real external check.
 *   - Client-facing surfaces MUST NOT name them or expose any control.
 *   - Internal/admin surfaces MAY name them, but only with the approved
 *     "not live yet" label and a disabled control unless Test Mode is active.
 *   - No stub result may use the forbidden words.
 *   - Even Test Mode MUST NOT make a stub provider look live; the only
 *     allowed Test Mode outcome is an audit-only `test_mode_bypass` envelope.
 */

export type StubProviderCategory = "KYB" | "Identity" | "Sanctions/PEP";

export interface StubProviderEntry {
  /** Internal technical id. Only surfaced on admin/dev/diagnostic surfaces. */
  readonly key: string;
  /** Display name. Only surfaced on admin/dev/diagnostic surfaces. */
  readonly display: string;
  /** Legacy domain tag, kept for back-compat with existing call sites. */
  readonly domain: "idv" | "sanctions";
  /** Generic, client-safe category label. */
  readonly category: StubProviderCategory;
  readonly is_live: false;
  readonly client_visible: false;
  readonly admin_visible: true;
  readonly requires_test_mode: true;
  readonly approved_warning_label: string;
  readonly allowed_statuses: readonly string[];
}

export const STUB_PROVIDER_LABEL_SHORT =
  "Not live yet — no external provider check is performed.";

export const STUB_PROVIDER_LABEL_LONG =
  "This provider is not connected yet. No real external verification, screening, or clearance is performed.";

export const STUB_PROVIDER_STATUS = {
  STUB_NOT_LIVE: "stub_not_live",
  NO_EXTERNAL_CHECK: "no_external_check",
  PROVIDER_NOT_CONNECTED: "provider_not_connected",
  TEST_MODE_BYPASS: "test_mode_bypass",
} as const;

const ALLOWED_STATUSES: readonly string[] = [
  STUB_PROVIDER_STATUS.STUB_NOT_LIVE,
  STUB_PROVIDER_STATUS.NO_EXTERNAL_CHECK,
  STUB_PROVIDER_STATUS.PROVIDER_NOT_CONNECTED,
  STUB_PROVIDER_STATUS.TEST_MODE_BYPASS,
];

export const STUB_PROVIDERS: readonly StubProviderEntry[] = [
  {
    key: "cipc",
    display: "CIPC",
    domain: "idv",
    category: "KYB",
    is_live: false,
    client_visible: false,
    admin_visible: true,
    requires_test_mode: true,
    approved_warning_label: STUB_PROVIDER_LABEL_SHORT,
    allowed_statuses: ALLOWED_STATUSES,
  },
  {
    key: "onfido",
    display: "Onfido",
    domain: "idv",
    category: "Identity",
    is_live: false,
    client_visible: false,
    admin_visible: true,
    requires_test_mode: true,
    approved_warning_label: STUB_PROVIDER_LABEL_SHORT,
    allowed_statuses: ALLOWED_STATUSES,
  },
  {
    key: "dow_jones",
    display: "Dow Jones",
    domain: "sanctions",
    category: "Sanctions/PEP",
    is_live: false,
    client_visible: false,
    admin_visible: true,
    requires_test_mode: true,
    approved_warning_label: STUB_PROVIDER_LABEL_SHORT,
    allowed_statuses: ALLOWED_STATUSES,
  },
  {
    key: "refinitiv",
    display: "Refinitiv",
    domain: "sanctions",
    category: "Sanctions/PEP",
    is_live: false,
    client_visible: false,
    admin_visible: true,
    requires_test_mode: true,
    approved_warning_label: STUB_PROVIDER_LABEL_SHORT,
    allowed_statuses: ALLOWED_STATUSES,
  },
] as const;

export type StubProviderKey = (typeof STUB_PROVIDERS)[number]["key"];

export const STUB_PROVIDER_KEYS: readonly string[] = STUB_PROVIDERS.map((p) => p.key);

export function isStubProvider(name: string | null | undefined): boolean {
  if (!name) return false;
  return STUB_PROVIDER_KEYS.includes(name.toLowerCase().trim());
}

export function getStubProvider(name: string | null | undefined): StubProviderEntry | null {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  return STUB_PROVIDERS.find((p) => p.key === key) ?? null;
}

/**
 * Words that MUST NEVER appear in any stub-provider result envelope, audit
 * payload, or admin/client surface that references a stub provider outcome.
 */
export const FORBIDDEN_STUB_RESULT_WORDS = [
  "verified",
  "cleared",
  "passed",
  "approved",
  "screened",
  "complete",
  "provider-confirmed",
  "provider_confirmed",
  "provider-approved",
  "provider_approved",
  "provider_matched",
  "live_check_complete",
] as const;

/**
 * Forbidden phrases (case-insensitive substring match) for the build-time
 * copy-drift guard. Catches softer wording that the single-word list misses.
 */
export const FORBIDDEN_STUB_RESULT_PHRASES = [
  "verification complete",
  "screening complete",
  "provider check passed",
  "provider match found",
  "external check complete",
] as const;

/** Canonical audit names for P010 events. */
export const STUB_PROVIDER_AUDIT = {
  NOT_LIVE: "stub_provider.not_live",
  BLOCKED: "stub_provider.blocked",
  NO_EXTERNAL_CHECK: "stub_provider.no_external_check",
  TEST_MODE_SIMULATED: "stub_provider.test_mode_simulated",
  VISIBILITY_SUPPRESSED: "stub_provider.visibility_suppressed",
} as const;

/** Approved error code returned by edge functions when a stub provider is selected. */
export const STUB_PROVIDER_ERROR_CODE = "STUB_PROVIDER_NOT_LIVE";

/**
 * Role-aware visibility decision (UI helper).
 * Returns whether a given role should ever see stub providers at all.
 */
export function stubProviderVisibleToRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === "platform_admin" || role === "developer";
}

/**
 * Role-aware action decision (UI helper).
 * A stub provider control is only ever runnable by admin/dev AND only when
 * Test Mode is active. Anything else returns `false` — including for admins
 * when Test Mode is off.
 */
export function stubProviderSimulationAllowed(
  role: string | null | undefined,
  testModeActive: boolean,
): boolean {
  return stubProviderVisibleToRole(role) && testModeActive === true;
}
