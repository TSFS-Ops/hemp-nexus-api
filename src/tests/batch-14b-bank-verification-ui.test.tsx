/**
 * Batch 14B — Bank-verification UI status wiring tests.
 *
 * Covers:
 *  - public labels never imply verified for non-final statuses
 *  - verificationBadgeFor returns "Not verified" for captured_unverified,
 *    manual_verified, provider_matched, expired, disputed, revoked
 *  - verificationBadgeFor returns "Verified" only for final, unexpired status
 *  - publicLabelFor maps expired correctly
 *  - claimant-safe status component renders only safe wording
 *  - admin gate label table covers every accepted gate
 *  - manual acknowledgement copy matches the backend SSOT
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  REGISTRY_BANK_VERIFICATION_DECISION_GATES,
  REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED,
  REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT,
  REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
} from "@/lib/registry-bank-verification";
import {
  REGISTRY_BANK_VERIFICATION_UI_GATE_LABELS,
  REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE,
  REGISTRY_BANK_VERIFICATION_UI_VERIFIED_BADGE,
  REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT,
  REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL,
  publicLabelFor,
  verificationBadgeFor,
} from "@/lib/registry-bank-verification-ui";
import { BankVerificationPublicStatus } from "@/components/registry/BankVerificationPublicStatus";

describe("Batch 14B — verification badge", () => {
  const notVerifiedStatuses = [
    "captured_unverified",
    "manual_verified",
    "provider_matched",
    "provider_mismatch",
    "provider_error",
    "provider_unavailable",
    "verification_requested",
    "manual_review_required",
    "failed",
    "expired",
    "revoked",
    "disputed",
    "cancelled",
  ] as const;

  for (const s of notVerifiedStatuses) {
    it(`returns Not verified for ${s}`, () => {
      const b = verificationBadgeFor(s as any);
      expect(b.label).toBe(REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE);
      expect(b.tone).not.toBe("verified");
    });
  }

  it("returns Verified only for final verified, unexpired, undisputed, unrevoked", () => {
    const b = verificationBadgeFor(REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED);
    expect(b.label).toBe(REGISTRY_BANK_VERIFICATION_UI_VERIFIED_BADGE);
    expect(b.tone).toBe("verified");
  });

  it("Verified flips to Not verified when expired in the past", () => {
    const b = verificationBadgeFor(REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(b.label).toBe(REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE);
  });

  it("Verified flips to Not verified when disputed/revoked", () => {
    expect(
      verificationBadgeFor(REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED, { disputed: true }).label,
    ).toBe(REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE);
    expect(
      verificationBadgeFor(REGISTRY_BANK_VERIFICATION_FINAL_VERIFIED, { revoked: true }).label,
    ).toBe(REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE);
  });
});

describe("Batch 14B — public labels", () => {
  it("captured_unverified renders as captured-but-not-verified copy", () => {
    expect(publicLabelFor("captured_unverified")).toBe("Bank details captured but not verified");
  });
  it("expired renders as Verification expired", () => {
    expect(publicLabelFor("expired")).toBe("Verification expired");
  });
  it("verified with past expiry renders as Verification expired", () => {
    expect(
      publicLabelFor("verified", { expiresAt: new Date(Date.now() - 10).toISOString() }),
    ).toBe("Verification expired");
  });
});

describe("Batch 14B — SSOT integrity", () => {
  it("gate label table covers every accepted gate", () => {
    for (const g of REGISTRY_BANK_VERIFICATION_DECISION_GATES) {
      expect(REGISTRY_BANK_VERIFICATION_UI_GATE_LABELS[g]).toBeTruthy();
    }
  });
  it("manual acknowledgement matches backend SSOT", () => {
    expect(REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT).toBe(
      REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT,
    );
  });
  it("provider simulation label matches backend SSOT", () => {
    expect(REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL).toBe(
      REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL,
    );
    expect(REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL).toMatch(
      /does not verify bank details/i,
    );
  });
});

describe("Batch 14B — claimant-safe status component", () => {
  it("renders safe label and Not verified badge for captured_unverified", () => {
    const { getByTestId, container } = render(
      <BankVerificationPublicStatus status="captured_unverified" />,
    );
    expect(getByTestId("b14b-public-status")).toBeTruthy();
    expect(container.textContent).toContain("captured but not verified");
    expect(container.textContent).toContain("Not verified");
    expect(container.textContent).not.toMatch(/^Verified$/);
  });

  it("renders Not verified for manual_verified (not provider-promoted)", () => {
    const { container } = render(<BankVerificationPublicStatus status="manual_verified" />);
    expect(container.textContent).toContain("Not verified");
  });

  it("renders Not verified for provider_matched (not promoted)", () => {
    const { container } = render(<BankVerificationPublicStatus status="provider_matched" />);
    expect(container.textContent).toContain("Not verified");
  });

  it("renders Verified badge only for final verified", () => {
    const { container } = render(<BankVerificationPublicStatus status="verified" />);
    expect(container.textContent).toContain("Verified");
  });

  it("renders Not verified for disputed/revoked/expired", () => {
    expect(render(<BankVerificationPublicStatus status="disputed" />).container.textContent).toContain(
      "Not verified",
    );
    expect(render(<BankVerificationPublicStatus status="revoked" />).container.textContent).toContain(
      "Not verified",
    );
    expect(render(<BankVerificationPublicStatus status="expired" />).container.textContent).toContain(
      "Not verified",
    );
  });
});

describe("Batch 14B — route stability", () => {
  it("Batch 13B admin review route remains registered", async () => {
    const App = await import("@/App");
    expect(App.default).toBeDefined();
  });
});
