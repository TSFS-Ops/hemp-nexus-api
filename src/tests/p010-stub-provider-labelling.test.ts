/**
 * P010 — Stub Provider Labelling / Hiding (hardened).
 *
 * Pins:
 *  - the four stub providers + policy metadata,
 *  - role-aware visibility helper (requester/counterparty/compliance hidden;
 *    platform_admin/developer visible-but-disabled unless Test Mode active),
 *  - forbidden status words (extended list) and forbidden phrases,
 *  - approved verbatim labels and error code,
 *  - canonical audit names (extended),
 *  - envelope helpers never contain a forbidden word and always carry
 *    `external_provider_called: false`.
 */
import { describe, it, expect } from "vitest";
import {
  STUB_PROVIDERS,
  STUB_PROVIDER_KEYS,
  isStubProvider,
  getStubProvider,
  STUB_PROVIDER_STATUS,
  FORBIDDEN_STUB_RESULT_WORDS,
  FORBIDDEN_STUB_RESULT_PHRASES,
  STUB_PROVIDER_AUDIT,
  STUB_PROVIDER_LABEL_SHORT,
  STUB_PROVIDER_LABEL_LONG,
  STUB_PROVIDER_ERROR_CODE,
  stubProviderVisibleToRole,
  stubProviderSimulationAllowed,
} from "@/lib/stub-providers";
import {
  buildStubProviderNotLiveEnvelope,
  buildStubProviderTestModeSimulationEnvelope,
} from "../../supabase/functions/_shared/stub-providers";

describe("P010 stub provider SSOT", () => {
  it("covers the four agreed stub providers", () => {
    expect([...STUB_PROVIDER_KEYS].sort()).toEqual(["cipc", "dow_jones", "onfido", "refinitiv"]);
  });

  it("every stub provider carries the hardened policy metadata", () => {
    for (const p of STUB_PROVIDERS) {
      expect(p.is_live).toBe(false);
      expect(p.client_visible).toBe(false);
      expect(p.admin_visible).toBe(true);
      expect(p.requires_test_mode).toBe(true);
      expect(["KYB", "Identity", "Sanctions/PEP"]).toContain(p.category);
      expect(p.approved_warning_label).toBe(STUB_PROVIDER_LABEL_SHORT);
      expect(p.allowed_statuses).toContain("stub_not_live");
      expect(p.allowed_statuses).toContain("test_mode_bypass");
    }
  });

  it("classifies each stub provider correctly", () => {
    for (const p of STUB_PROVIDERS) {
      expect(isStubProvider(p.key)).toBe(true);
      expect(isStubProvider(p.key.toUpperCase())).toBe(true);
      expect(getStubProvider(p.key)?.key).toBe(p.key);
    }
    expect(isStubProvider("companies_house")).toBe(false);
    expect(isStubProvider("dilisense")).toBe(false);
    expect(isStubProvider(null)).toBe(false);
    expect(getStubProvider("companies_house")).toBeNull();
  });

  it("uses only safe internal status values", () => {
    expect(STUB_PROVIDER_STATUS.STUB_NOT_LIVE).toBe("stub_not_live");
    expect(STUB_PROVIDER_STATUS.NO_EXTERNAL_CHECK).toBe("no_external_check");
    expect(STUB_PROVIDER_STATUS.PROVIDER_NOT_CONNECTED).toBe("provider_not_connected");
    expect(STUB_PROVIDER_STATUS.TEST_MODE_BYPASS).toBe("test_mode_bypass");
    for (const v of Object.values(STUB_PROVIDER_STATUS)) {
      for (const w of FORBIDDEN_STUB_RESULT_WORDS) {
        expect(v.toLowerCase()).not.toContain(w);
      }
    }
  });

  it("forbids the extended overclaim word list", () => {
    expect([...FORBIDDEN_STUB_RESULT_WORDS].sort()).toEqual(
      [
        "approved",
        "cleared",
        "complete",
        "live_check_complete",
        "passed",
        "provider-approved",
        "provider-confirmed",
        "provider_approved",
        "provider_confirmed",
        "provider_matched",
        "screened",
        "verified",
      ],
    );
  });

  it("forbids the extended overclaim phrase list", () => {
    expect([...FORBIDDEN_STUB_RESULT_PHRASES].sort()).toEqual(
      [
        "external check complete",
        "provider check passed",
        "provider match found",
        "screening complete",
        "verification complete",
      ],
    );
  });

  it("uses the approved verbatim labels and error code", () => {
    expect(STUB_PROVIDER_LABEL_SHORT).toBe(
      "Not live yet — no external provider check is performed.",
    );
    expect(STUB_PROVIDER_LABEL_LONG).toBe(
      "This provider is not connected yet. No real external verification, screening, or clearance is performed.",
    );
    expect(STUB_PROVIDER_ERROR_CODE).toBe("STUB_PROVIDER_NOT_LIVE");
  });

  it("pins the canonical audit names (hardened)", () => {
    expect(STUB_PROVIDER_AUDIT.NOT_LIVE).toBe("stub_provider.not_live");
    expect(STUB_PROVIDER_AUDIT.BLOCKED).toBe("stub_provider.blocked");
    expect(STUB_PROVIDER_AUDIT.NO_EXTERNAL_CHECK).toBe("stub_provider.no_external_check");
    expect(STUB_PROVIDER_AUDIT.TEST_MODE_SIMULATED).toBe("stub_provider.test_mode_simulated");
    expect(STUB_PROVIDER_AUDIT.VISIBILITY_SUPPRESSED).toBe("stub_provider.visibility_suppressed");
  });
});

describe("P010 role × Test Mode visibility matrix", () => {
  const NON_ADMIN_ROLES = ["requester", "trader", "counterparty", "compliance_analyst"];

  it.each(NON_ADMIN_ROLES)("hides stub providers from role=%s", (role) => {
    expect(stubProviderVisibleToRole(role)).toBe(false);
    expect(stubProviderSimulationAllowed(role, true)).toBe(false);
    expect(stubProviderSimulationAllowed(role, false)).toBe(false);
  });

  it("hides stub providers when role is missing/null", () => {
    expect(stubProviderVisibleToRole(null)).toBe(false);
    expect(stubProviderVisibleToRole(undefined)).toBe(false);
    expect(stubProviderSimulationAllowed(null, true)).toBe(false);
  });

  it("platform_admin sees providers, but only simulates when Test Mode is ON", () => {
    expect(stubProviderVisibleToRole("platform_admin")).toBe(true);
    expect(stubProviderSimulationAllowed("platform_admin", false)).toBe(false);
    expect(stubProviderSimulationAllowed("platform_admin", true)).toBe(true);
  });

  it("developer sees providers, but only simulates when Test Mode is ON", () => {
    expect(stubProviderVisibleToRole("developer")).toBe(true);
    expect(stubProviderSimulationAllowed("developer", false)).toBe(false);
    expect(stubProviderSimulationAllowed("developer", true)).toBe(true);
  });
});

describe("P010 envelope helpers", () => {
  function containsForbidden(value: unknown): string | null {
    const s = JSON.stringify(value).toLowerCase();
    for (const w of FORBIDDEN_STUB_RESULT_WORDS) {
      // The label intentionally uses the word "verification" but never the
      // stem-bounded forbidden token "verified". Use word-boundary regex.
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(s)) return `word:${w}`;
    }
    for (const phrase of FORBIDDEN_STUB_RESULT_PHRASES) {
      if (s.includes(phrase)) return `phrase:${phrase}`;
    }
    return null;
  }

  it.each(["cipc", "onfido", "dow_jones", "refinitiv"])(
    "not-live envelope for %s contains no forbidden word and never calls an external provider",
    (provider) => {
      const env = buildStubProviderNotLiveEnvelope(provider, "req-1");
      expect(env.status).toBe("stub_not_live");
      expect(env.external_provider_called).toBe(false);
      expect(env.error).toBe("STUB_PROVIDER_NOT_LIVE");
      expect(containsForbidden(env)).toBeNull();
    },
  );

  it.each(["cipc", "onfido", "dow_jones", "refinitiv"])(
    "test-mode simulation envelope for %s is audit-only with no forbidden wording",
    (provider) => {
      const env = buildStubProviderTestModeSimulationEnvelope(provider, "req-2");
      expect(env.status).toBe("test_mode_bypass");
      expect(env.external_provider_called).toBe(false);
      expect(env.test_mode_active).toBe(true);
      expect(env.ok).toBe(true);
      expect(containsForbidden(env)).toBeNull();
    },
  );
});
