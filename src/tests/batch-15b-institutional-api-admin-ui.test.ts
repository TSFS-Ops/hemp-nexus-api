/**
 * Batch 15B — Institutional API Admin UI tests.
 *
 * Logic-level tests for the UI SSOT and pure helpers. No DOM rendering is
 * required because all safety-critical decisions are routed through the
 * functions below.
 */
import { describe, expect, it } from "vitest";
import {
  REGISTRY_API_UI_COPY,
  REGISTRY_API_LIFECYCLE_LABELS,
  REGISTRY_API_MODE_LABELS,
  REGISTRY_API_BLOCKED_REASON_LABELS,
  buildScopeOptions,
  describeBlockedReason,
  isClientLifecycleActive,
  isClientLifecycleBlocked,
  isProductionApprovalReady,
  lifecycleTone,
  paymentStatusLabel,
  safeKeyReference,
  summariseList,
} from "@/lib/registry-api-hardening-ui";
import {
  REGISTRY_API_FORBIDDEN_SCOPES,
  REGISTRY_API_HARDENED_SCOPES,
  REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT,
} from "@/lib/registry-api-hardening";

describe("Batch 15B UI SSOT", () => {
  it("production acknowledgement copy is the canonical Batch 15 text", () => {
    expect(REGISTRY_API_UI_COPY.productionAcknowledgement).toBe(
      REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT,
    );
  });

  it("exposes test-console warning and key-visibility warning", () => {
    expect(REGISTRY_API_UI_COPY.testConsoleWarning).toMatch(/Safe envelope/i);
    expect(REGISTRY_API_UI_COPY.keyVisibilityWarning).toMatch(/Full API keys/i);
  });

  it("lifecycle and mode labels cover all SSOT values", () => {
    expect(Object.keys(REGISTRY_API_LIFECYCLE_LABELS).length).toBeGreaterThanOrEqual(10);
    expect(REGISTRY_API_MODE_LABELS.production).toBe("Production");
    expect(REGISTRY_API_MODE_LABELS.disabled).toBe("Disabled");
  });

  it("blocked reason labels include payment-status-not-verified and rate_limited", () => {
    expect(REGISTRY_API_BLOCKED_REASON_LABELS.payment_status_not_verified).toBeDefined();
    expect(REGISTRY_API_BLOCKED_REASON_LABELS.rate_limited).toBeDefined();
    expect(describeBlockedReason("scope_not_allowed")).toBe("Scope not allowed");
    expect(describeBlockedReason(null)).toBe("Blocked");
  });
});

describe("Batch 15B lifecycle helpers", () => {
  it("active statuses render as active, blocked statuses as not active", () => {
    expect(isClientLifecycleActive("sandbox_active")).toBe(true);
    expect(isClientLifecycleActive("production_active")).toBe(true);
    expect(isClientLifecycleActive("pending_approval")).toBe(false);

    for (const blocked of ["suspended", "revoked", "expired", "disabled"]) {
      expect(isClientLifecycleActive(blocked)).toBe(false);
      expect(isClientLifecycleBlocked(blocked)).toBe(true);
    }
  });

  it("lifecycle tone is bad for blocked, good for production_active", () => {
    expect(lifecycleTone("suspended")).toBe("bad");
    expect(lifecycleTone("revoked")).toBe("bad");
    expect(lifecycleTone("production_active")).toBe("good");
    expect(lifecycleTone("sandbox_active")).toBe("info");
    expect(lifecycleTone("pending_approval")).toBe("warning");
    expect(lifecycleTone(null)).toBe("neutral");
  });
});

describe("Batch 15B scope options", () => {
  it("includes every hardened scope as selectable", () => {
    const opts = buildScopeOptions();
    for (const s of REGISTRY_API_HARDENED_SCOPES) {
      const row = opts.find((o) => o.scopeKey === s);
      expect(row).toBeDefined();
      expect(row!.selectable).toBe(true);
      expect(row!.forbidden).toBe(false);
    }
  });

  it("renders forbidden scopes as visible but non-selectable", () => {
    const opts = buildScopeOptions();
    for (const f of REGISTRY_API_FORBIDDEN_SCOPES) {
      const row = opts.find((o) => o.scopeKey === f);
      expect(row).toBeDefined();
      expect(row!.selectable).toBe(false);
      expect(row!.forbidden).toBe(true);
    }
  });

  it("forbidden raw bank / personal / evidence scopes are present", () => {
    const opts = buildScopeOptions();
    const keys = opts.map((o) => o.scopeKey);
    expect(keys).toContain("registry.bank.raw.read");
    expect(keys).toContain("registry.bank.unmasked.read");
    expect(keys).toContain("registry.personal_contact.raw.read");
    expect(keys).toContain("registry.evidence.raw.read");
  });
});

describe("Batch 15B safe key reference", () => {
  it("renders only safe placeholder + last four", () => {
    expect(safeKeyReference({ lastFour: "1234", keyPrefix: "sk_live" })).toBe(
      "sk_live_••••1234",
    );
    expect(safeKeyReference({ lastFour: null, keyPrefix: null })).toBe("—");
  });

  it("never leaks a long-looking secret", () => {
    expect(safeKeyReference({ lastFour: "supersecretvalue", keyPrefix: "sk" })).toBe("••••");
    expect(safeKeyReference({ lastFour: "12", keyPrefix: "supersecretprefixlong" })).toBe("••••");
  });
});

describe("Batch 15B production approval checklist", () => {
  const base = {
    hasAllowedCountries: true,
    hasAllowedScopes: true,
    hasAllowedUseCase: true,
    hasRateLimitProfile: true,
    hasBusinessDecisionReference: true,
    hasApprovalReason: true,
    acknowledged: true,
  };

  it("is ready only when every item is satisfied", () => {
    expect(isProductionApprovalReady(base)).toBe(true);
  });

  it("is NOT ready if acknowledgement is unchecked", () => {
    expect(isProductionApprovalReady({ ...base, acknowledged: false })).toBe(false);
  });

  it("is NOT ready without a business decision reference", () => {
    expect(
      isProductionApprovalReady({ ...base, hasBusinessDecisionReference: false }),
    ).toBe(false);
  });

  it("is NOT ready without countries / scopes / use case / rate profile", () => {
    expect(isProductionApprovalReady({ ...base, hasAllowedCountries: false })).toBe(false);
    expect(isProductionApprovalReady({ ...base, hasAllowedScopes: false })).toBe(false);
    expect(isProductionApprovalReady({ ...base, hasAllowedUseCase: false })).toBe(false);
    expect(isProductionApprovalReady({ ...base, hasRateLimitProfile: false })).toBe(false);
  });
});

describe("Batch 15B payment-status labelling", () => {
  it("renders Verified ONLY for usable + final + unexpired", () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const r = paymentStatusLabel({
      resultState: "usable",
      usable: true,
      rawVerificationStatus: "verified",
      expiresAt: future,
    });
    expect(r.isVerified).toBe(true);
    expect(r.label).toBe("Verified");
  });

  it("renders captured_unverified as Not verified", () => {
    const r = paymentStatusLabel({
      resultState: "bank_details_captured_unverified",
      usable: false,
      rawVerificationStatus: "captured_unverified",
    });
    expect(r.isVerified).toBe(false);
    expect(r.label).toMatch(/Not verified/);
  });

  it("renders manual_verified, provider_matched, manual_review_required as Not verified", () => {
    for (const s of ["manual_verified", "provider_matched", "manual_review_required"]) {
      const r = paymentStatusLabel({
        resultState: "bank_verification_pending",
        usable: false,
        rawVerificationStatus: s,
      });
      expect(r.isVerified).toBe(false);
      expect(r.label).toMatch(/Not verified/);
    }
  });

  it("renders expired / revoked / disputed as Not verified", () => {
    for (const s of ["expired", "revoked", "disputed"]) {
      const r = paymentStatusLabel({
        resultState: `bank_verification_${s}` as any,
        usable: false,
        rawVerificationStatus: s,
      });
      expect(r.isVerified).toBe(false);
      expect(r.label).toMatch(/Not verified/);
    }
  });

  it("renders verified but EXPIRED as Not verified", () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = paymentStatusLabel({
      resultState: "usable",
      usable: true,
      rawVerificationStatus: "verified",
      expiresAt: past,
    });
    expect(r.isVerified).toBe(false);
  });

  it("renders not-usable as Not verified even when result_state is usable", () => {
    const r = paymentStatusLabel({
      resultState: "usable",
      usable: false,
      rawVerificationStatus: "verified",
    });
    expect(r.isVerified).toBe(false);
  });

  it("renders provider_error / provider_unavailable / failed as Not verified", () => {
    for (const s of ["provider_error", "provider_unavailable", "failed"]) {
      const r = paymentStatusLabel({
        resultState: "bank_verification_failed",
        usable: false,
        rawVerificationStatus: s,
      });
      expect(r.isVerified).toBe(false);
    }
  });
});

describe("Batch 15B summariseList helper", () => {
  it("returns em-dash for empty/null lists", () => {
    expect(summariseList(null)).toBe("—");
    expect(summariseList([])).toBe("—");
  });
  it("joins short lists and truncates long ones", () => {
    expect(summariseList(["ZA", "NG"])).toBe("ZA, NG");
    expect(summariseList(["ZA", "NG", "KE", "GH"], 3)).toBe("ZA, NG, KE +1");
  });
});
