/**
 * Batch 13B — Bank-detail UI thin-slice tests.
 * Pure-logic + SSOT-driven assertions; full DOM/integration coverage lands
 * in the follow-up pass that wires evidence/dispute/revocation surfaces.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT,
  REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING,
  isBankDetailB13Verified,
  findMissingBankFields,
} from "@/lib/registry-bank-details-b13";
import {
  REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL,
  REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE,
  REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER,
  REGISTRY_BANK_DETAIL_B13_UI_DECLARATION,
  REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE,
} from "@/lib/registry-bank-details-b13-ui";

describe("Batch 13B — bank-detail UI invariants", () => {
  it("renders a label for every B13 status", () => {
    for (const s of REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES) {
      expect(REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it("captured_unverified label does not say 'verified'", () => {
    const label = REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL.captured_unverified;
    expect(label.toLowerCase()).not.toMatch(/\bverified\b(?! bank| account)/i);
    expect(label).toBe("Captured but not verified");
  });

  it("isBankDetailB13Verified is always false", () => {
    for (const s of REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES) {
      expect(isBankDetailB13Verified(s)).toBe(false);
    }
  });

  it("not-verified badge string is stable", () => {
    expect(REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE).toBe("Not verified");
  });

  it("authority blocker copy is fixed and warns claim approval is not enough", () => {
    expect(REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER).toContain("approved authority");
  });

  it("declaration copy mentions authorisation, review-only and rejection risk", () => {
    expect(REGISTRY_BANK_DETAIL_B13_UI_DECLARATION).toMatch(/authoris/);
    expect(REGISTRY_BANK_DETAIL_B13_UI_DECLARATION).toMatch(/review/);
    expect(REGISTRY_BANK_DETAIL_B13_UI_DECLARATION).toMatch(/rejected|revoked|escalated/);
  });

  it("consent wording string contains the captured-not-verified guarantee", () => {
    expect(REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING).toMatch(/captured/);
    expect(REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING).toMatch(/not verified/);
  });

  it("admin acceptance acknowledgement is the SSOT string", () => {
    expect(REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT).toMatch(/captured\/unverified/);
    expect(REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT).toMatch(/does not verify/);
  });

  it("unmask UI notice gates by role and requires a reason", () => {
    expect(REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE).toMatch(/platform admins/);
    expect(REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE).toMatch(/reason/);
    expect(REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE).toMatch(/audit/);
  });

  it("South Africa form requires branch code", () => {
    const missing = findMissingBankFields("ZA", {
      account_holder_name: "Co A",
      bank_name: "X",
      account_number: "1234567890",
      account_type: "current",
      currency_code: "ZAR",
      company_reference: "ZA-1",
    });
    expect(missing).toContain("branch_code");
  });

  it("Nigeria form does not require branch code", () => {
    const missing = findMissingBankFields("NG", {
      account_holder_name: "Co B",
      bank_name: "Y",
      account_number: "0123456789",
      account_type: "current",
      currency_code: "NGN",
      company_reference: "NG-1",
    });
    expect(missing).not.toContain("branch_code");
    expect(missing).toEqual([]);
  });

  it("default-country form accepts IBAN-style submissions", () => {
    const missing = findMissingBankFields("XX", {
      account_holder_name: "Co C",
      bank_name: "Z",
      currency_code: "USD",
      country_code: "XX",
      company_reference: "XX-1",
    });
    expect(missing).toEqual([]);
  });
});
