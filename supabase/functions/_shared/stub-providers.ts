/**
 * P010 — Stub / not-connected provider labelling (edge SSOT).
 *
 * Mirrored at `src/lib/stub-providers.ts`. The two files MUST stay in sync;
 * `scripts/check-stub-providers-parity.mjs` enforces this at prebuild.
 *
 * See the browser SSOT for the LEGACY_PROVIDER_KEY_ALIASES rationale — this
 * file carries the same back-compat map so historical DB rows that still
 * hold the deprecated vendor identifiers continue to classify correctly.
 */

export type StubProviderCategory = "KYB" | "Identity" | "Sanctions/PEP";

export interface StubProviderEntry {
  readonly key: string;
  readonly display: string;
  readonly domain: "idv" | "sanctions";
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
    key: "company_registry",
    display: "Company registry provider",
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
    key: "identity_document",
    display: "Identity-document provider",
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
    key: "sanctions_screening",
    display: "Sanctions screening provider",
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
    key: "pep_screening",
    display: "PEP screening provider",
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

const LEGACY_PROVIDER_KEY_ALIASES: Readonly<Record<string, string>> = {
  cipc: "company_registry",
  onfido: "identity_document",
  dow_jones: "sanctions_screening",
  "dow-jones": "sanctions_screening",
  dowjones: "sanctions_screening",
  refinitiv: "pep_screening",
};

function normaliseKey(name: string): string {
  const k = name.toLowerCase().trim();
  return LEGACY_PROVIDER_KEY_ALIASES[k] ?? k;
}

export function isStubProvider(name: string | null | undefined): boolean {
  if (!name) return false;
  return STUB_PROVIDER_KEYS.includes(normaliseKey(name));
}

export function getStubProvider(name: string | null | undefined): StubProviderEntry | null {
  if (!name) return null;
  const key = normaliseKey(name);
  return STUB_PROVIDERS.find((p) => p.key === key) ?? null;
}

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

export const FORBIDDEN_STUB_RESULT_PHRASES = [
  "verification complete",
  "screening complete",
  "provider check passed",
  "provider match found",
  "external check complete",
] as const;

export const STUB_PROVIDER_AUDIT = {
  NOT_LIVE: "stub_provider.not_live",
  BLOCKED: "stub_provider.blocked",
  NO_EXTERNAL_CHECK: "stub_provider.no_external_check",
  TEST_MODE_SIMULATED: "stub_provider.test_mode_simulated",
  VISIBILITY_SUPPRESSED: "stub_provider.visibility_suppressed",
} as const;

export const STUB_PROVIDER_ERROR_CODE = "STUB_PROVIDER_NOT_LIVE";

export function stubProviderVisibleToRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === "platform_admin" || role === "developer";
}

export function stubProviderSimulationAllowed(
  role: string | null | undefined,
  testModeActive: boolean,
): boolean {
  return stubProviderVisibleToRole(role) && testModeActive === true;
}

export function buildStubProviderNotLiveEnvelope(provider: string, requestId: string) {
  return {
    success: false,
    ok: false,
    error: STUB_PROVIDER_ERROR_CODE,
    provider,
    status: STUB_PROVIDER_STATUS.STUB_NOT_LIVE,
    message: STUB_PROVIDER_LABEL_LONG,
    external_provider_called: false,
    requestId,
  };
}

export function buildStubProviderTestModeSimulationEnvelope(
  provider: string,
  requestId: string,
) {
  return {
    success: true,
    ok: true,
    provider,
    status: STUB_PROVIDER_STATUS.TEST_MODE_BYPASS,
    message: STUB_PROVIDER_LABEL_LONG,
    external_provider_called: false,
    test_mode_active: true,
    requestId,
  };
}
