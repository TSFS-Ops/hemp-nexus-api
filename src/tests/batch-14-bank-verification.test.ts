// Batch 14 — Bank verification decision-layer tests.
import { describe, it, expect } from "vitest";
import {
  REGISTRY_BANK_VERIFICATION_MODES,
  REGISTRY_BANK_VERIFICATION_STATUSES,
  REGISTRY_BANK_VERIFICATION_DEFAULT_MODE,
  REGISTRY_BANK_MANUAL_VERIFICATION_DISABLED_BY_DEFAULT,
  REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT,
  REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES,
  REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED,
  REGISTRY_BANK_VERIFICATION_MODES_INELIGIBLE_FOR_VERIFIED,
  REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS,
  REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
  REGISTRY_BANK_VERIFICATION_AUDIT_EVENT_NAMES,
  REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS,
  mapVerificationStatusToApiFlag,
  isFinalVerified,
} from "@/lib/registry-bank-verification";

describe("Batch 14 — verification SSOT", () => {
  it("includes all required modes", () => {
    for (const m of ["not_available","manual_review_only","manual_verification_allowed","provider_pending","provider_sandbox","provider_live","verification_disabled"]) {
      expect(REGISTRY_BANK_VERIFICATION_MODES).toContain(m);
    }
  });
  it("default mode is not_available", () => {
    expect(REGISTRY_BANK_VERIFICATION_DEFAULT_MODE).toBe("not_available");
  });
  it("manual verification is disabled by default", () => {
    expect(REGISTRY_BANK_MANUAL_VERIFICATION_DISABLED_BY_DEFAULT).toBe(true);
  });
  it("ack text is the canonical wording", () => {
    expect(REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT).toContain("not a provider-confirmed bank verification");
  });
  it("includes all required statuses", () => {
    for (const s of ["captured_unverified","manual_verified","provider_matched","verified","failed","expired","revoked","disputed","cancelled","provider_pending","provider_error","provider_unavailable"]) {
      expect(REGISTRY_BANK_VERIFICATION_STATUSES).toContain(s);
    }
  });
  it("manual_verified and provider_matched are NOT verified", () => {
    expect(REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES).toContain("manual_verified");
    expect(REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES).toContain("provider_matched");
  });
  it("final verified is `verified`", () => {
    expect(REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED).toBe("verified");
    expect(isFinalVerified("verified")).toBe(true);
    expect(isFinalVerified("manual_verified")).toBe(false);
    expect(isFinalVerified("provider_matched")).toBe(false);
  });
});

describe("Batch 14 — API payment flag mapping", () => {
  it("maps verified → verified", () => {
    expect(mapVerificationStatusToApiFlag("verified")).toBe("verified");
  });
  it.each([
    ["captured_unverified"],["verification_requested"],["manual_review_required"],
    ["provider_pending"],["provider_check_in_progress"],["provider_matched"],
    ["manual_verified"],["provider_mismatch"],["provider_error"],
    ["provider_unavailable"],["failed"],["cancelled"],
  ])("maps %s → not_verified", (s) => {
    expect(mapVerificationStatusToApiFlag(s as any)).toBe("not_verified");
  });
  it("maps expired/revoked/disputed to their own flags (still not 'verified')", () => {
    expect(mapVerificationStatusToApiFlag("expired")).toBe("expired");
    expect(mapVerificationStatusToApiFlag("revoked")).toBe("revoked");
    expect(mapVerificationStatusToApiFlag("disputed")).toBe("disputed");
  });
});

describe("Batch 14 — gate eligibility", () => {
  it("ineligible modes cannot reach verified", () => {
    expect(REGISTRY_BANK_VERIFICATION_MODES_INELIGIBLE_FOR_VERIFIED).toEqual(
      expect.arrayContaining(["not_available","manual_review_only","provider_pending","verification_disabled"]),
    );
  });
  it("provider sandbox has zero production validity days", () => {
    expect(REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.provider_sandbox).toBe(0);
  });
  it("provider verified default expiry is 90 days", () => {
    expect(REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.provider_verified).toBe(90);
  });
  it("manual verified default expiry is 30 days, high-risk 14 days", () => {
    expect(REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.manual_verified).toBe(30);
    expect(REGISTRY_BANK_VERIFICATION_EXPIRY_DAYS.high_risk_manual_verified).toBe(14);
  });
});

describe("Batch 14 — provider simulation copy", () => {
  it("is labelled test-only", () => {
    expect(REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL).toBe(
      "Provider simulation only. This does not verify bank details.",
    );
  });
});

describe("Batch 14 — audit events", () => {
  it("includes promotion + block + api-status events", () => {
    for (const e of [
      "registry_bank_verification_promoted_to_verified",
      "registry_bank_verification_promotion_blocked",
      "registry_bank_verification_api_status_checked",
      "registry_bank_verification_provider_simulated",
      "registry_bank_verification_expired",
      "registry_bank_verification_manual_verified",
    ]) {
      expect(REGISTRY_BANK_VERIFICATION_AUDIT_EVENT_NAMES).toContain(e);
    }
  });
});

describe("Batch 14 — public labels are conservative", () => {
  it("manual_verified label says 'under Izenzo review process'", () => {
    expect(REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS.manual_verified).toContain("Izenzo review process");
  });
  it("captured_unverified label says 'not verified'", () => {
    expect(REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS.captured_unverified).toContain("not verified");
  });
  it("provider_matched label does not claim verified", () => {
    expect(REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS.provider_matched.toLowerCase()).not.toMatch(/^verified$/);
  });
});
