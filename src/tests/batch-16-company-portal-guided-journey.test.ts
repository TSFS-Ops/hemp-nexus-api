/**
 * Batch 16 — Company Portal Guided Journey tests.
 *
 * Covers the next-step engine, verification-wording downgrade rules,
 * timeline whitelist filter, and forbidden-field detection.
 */
import { describe, expect, it } from "vitest";
import {
  PORTAL_VERIFICATION_NON_VERIFIED,
  computeNextStep,
  filterSafeTimeline,
  hasForbiddenField,
  safeVerificationLabel,
  PORTAL_NEXT_STEP_LABEL,
  PORTAL_VERIFICATION_LABEL,
  PORTAL_CORRECTION_ACK,
  PORTAL_DISPUTE_ACK,
  PORTAL_REVOCATION_BANK_ACK,
} from "@/lib/registry-company-portal-ssot";

const base = {
  claim: "approved",
  authority: "approved",
  bankDetail: "captured_unverified",
  verification: "not_available",
} as const;

describe("Batch 16 — next-step engine", () => {
  it("returns start_claim when no claim exists", () => {
    expect(computeNextStep({ ...base, claim: "not_started" })).toBe("start_claim");
  });
  it("returns respond_to_evidence_request when evidence requested on claim", () => {
    expect(computeNextStep({ ...base, claim: "evidence_requested" })).toBe(
      "respond_to_evidence_request",
    );
  });
  it("returns wait_for_claim_review when claim under review", () => {
    expect(computeNextStep({ ...base, claim: "under_review" })).toBe("wait_for_claim_review");
  });
  it("returns request_authority before bank detail submission", () => {
    expect(computeNextStep({ ...base, authority: "not_requested", bankDetail: "not_submitted" })).toBe(
      "request_authority",
    );
  });
  it("returns submit_bank_details only when authority approved", () => {
    expect(computeNextStep({ ...base, authority: "approved", bankDetail: "not_submitted" })).toBe(
      "submit_bank_details",
    );
  });
  it("returns wait_for_bank_detail_review when under review", () => {
    expect(computeNextStep({ ...base, bankDetail: "under_review" })).toBe(
      "wait_for_bank_detail_review",
    );
  });
  it("returns request_verification when expired", () => {
    expect(
      computeNextStep({ ...base, verification: "expired", verificationExpired: true }),
    ).toBe("request_verification");
  });
  it("returns resolve_dispute when dispute open", () => {
    expect(computeNextStep({ ...base, hasOpenDispute: true })).toBe("resolve_dispute");
  });
  it("returns none when fully verified and nothing pending", () => {
    expect(computeNextStep({ ...base, verification: "verified" })).toBe("none");
  });
  it("all next-step keys have labels", () => {
    for (const key of Object.keys(PORTAL_NEXT_STEP_LABEL)) {
      expect(PORTAL_NEXT_STEP_LABEL[key as keyof typeof PORTAL_NEXT_STEP_LABEL]).toBeTruthy();
    }
  });
});

describe("Batch 16 — verification wording safety", () => {
  it("captured_unverified portal mapping never says Verified", () => {
    // captured_unverified flows through bank-detail mapping, not as a
    // verification state; here we cover the verification non-final list.
    for (const s of PORTAL_VERIFICATION_NON_VERIFIED) {
      expect(safeVerificationLabel(s)).not.toBe("Verified");
    }
  });
  it("manual_verified renders the Izenzo manual label, not 'Verified'", () => {
    expect(safeVerificationLabel("manual_verified")).toBe(
      PORTAL_VERIFICATION_LABEL.manual_verified,
    );
    expect(safeVerificationLabel("manual_verified")).not.toBe("Verified");
  });
  it("disputed never renders as Verified", () => {
    expect(safeVerificationLabel("verified", { disputed: true })).toBe(
      PORTAL_VERIFICATION_LABEL.disputed,
    );
  });
  it("revoked never renders as Verified", () => {
    expect(safeVerificationLabel("verified", { revoked: true })).toBe(
      PORTAL_VERIFICATION_LABEL.revoked,
    );
  });
  it("expired never renders as Verified", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(safeVerificationLabel("verified", { expiresAt: past })).toBe(
      PORTAL_VERIFICATION_LABEL.expired,
    );
  });
  it("final unexpired verified renders as Verified", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(safeVerificationLabel("verified", { expiresAt: future })).toBe("Verified");
  });
});

describe("Batch 16 — timeline whitelist", () => {
  it("strips events not on the safe whitelist", () => {
    const out = filterSafeTimeline([
      { event_name: "claim_approved" },
      { event_name: "raw_bank_dump" },
      { event_name: "admin_internal_note_added" },
      { event_name: "verification_disputed" },
    ]);
    expect(out.map((e) => e.event_name)).toEqual(["claim_approved", "verification_disputed"]);
  });
});

describe("Batch 16 — forbidden-field detector", () => {
  it("flags raw bank fields", () => {
    expect(hasForbiddenField({ account_number: "x" })).toBe(true);
    expect(hasForbiddenField({ iban: "x" })).toBe(true);
    expect(hasForbiddenField({ provider_payload: {} })).toBe(true);
    expect(hasForbiddenField({ admin_note_internal: "x" })).toBe(true);
  });
  it("passes safe objects", () => {
    expect(hasForbiddenField({ company_name: "Acme", country_code: "ZA" })).toBe(false);
  });
});

describe("Batch 16 — acknowledgement SSOT", () => {
  it("has correction, dispute and revocation copy", () => {
    expect(PORTAL_CORRECTION_ACK).toMatch(/reviewed/i);
    expect(PORTAL_DISPUTE_ACK).toMatch(/automatically/i);
    expect(PORTAL_REVOCATION_BANK_ACK).toMatch(/not verified|not usable/i);
  });
});
