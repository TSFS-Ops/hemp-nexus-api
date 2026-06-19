/**
 * P010 — Stub Provider Labelling / Hiding.
 *
 * These tests pin the policy:
 *  - The four stub providers are present and detected.
 *  - The forbidden result words are enforced.
 *  - Approved labels are verbatim.
 *  - The envelope helper never uses a forbidden word.
 */
import { describe, it, expect } from "vitest";
import {
  STUB_PROVIDERS,
  STUB_PROVIDER_KEYS,
  isStubProvider,
  STUB_PROVIDER_STATUS,
  FORBIDDEN_STUB_RESULT_WORDS,
  STUB_PROVIDER_AUDIT,
  STUB_PROVIDER_LABEL_SHORT,
  STUB_PROVIDER_LABEL_LONG,
  STUB_PROVIDER_ERROR_CODE,
} from "@/lib/stub-providers";

describe("P010 stub provider SSOT", () => {
  it("covers the four agreed stub providers", () => {
    expect(STUB_PROVIDER_KEYS.sort()).toEqual(["cipc", "dow_jones", "onfido", "refinitiv"]);
  });

  it("classifies each stub provider correctly", () => {
    for (const p of STUB_PROVIDERS) {
      expect(isStubProvider(p.key)).toBe(true);
      expect(isStubProvider(p.key.toUpperCase())).toBe(true);
    }
    expect(isStubProvider("companies_house")).toBe(false);
    expect(isStubProvider("dilisense")).toBe(false);
    expect(isStubProvider("stub")).toBe(false);
    expect(isStubProvider(null)).toBe(false);
    expect(isStubProvider("")).toBe(false);
  });

  it("uses only safe internal status values", () => {
    expect(STUB_PROVIDER_STATUS.STUB_NOT_LIVE).toBe("stub_not_live");
    expect(STUB_PROVIDER_STATUS.NO_EXTERNAL_CHECK).toBe("no_external_check");
    expect(STUB_PROVIDER_STATUS.PROVIDER_NOT_CONNECTED).toBe("provider_not_connected");
    for (const v of Object.values(STUB_PROVIDER_STATUS)) {
      for (const w of FORBIDDEN_STUB_RESULT_WORDS) {
        expect(v.toLowerCase()).not.toContain(w);
      }
    }
  });

  it("forbids overclaim words on stub-provider results", () => {
    expect([...FORBIDDEN_STUB_RESULT_WORDS].sort()).toEqual(
      ["approved", "cleared", "complete", "passed", "screened", "verified"],
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

  it("pins the canonical audit names", () => {
    expect(STUB_PROVIDER_AUDIT.NOT_LIVE).toBe("stub_provider.not_live");
    expect(STUB_PROVIDER_AUDIT.BLOCKED).toBe("stub_provider.blocked");
    expect(STUB_PROVIDER_AUDIT.NO_EXTERNAL_CHECK).toBe("stub_provider.no_external_check");
  });
});
