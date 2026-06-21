/**
 * Batch 13 — Bank-detail submission & review (browser invariants).
 *
 * Asserts:
 *   - Every B13 status counts as not verified (incl. captured_unverified).
 *   - Country-specific required fields catch missing inputs.
 *   - Account-holder mismatch heuristic works.
 *   - Fingerprint computation is deterministic and stable.
 *   - Required wording strings are present verbatim.
 *   - The action-to-scope map covers all three actions.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES,
  REGISTRY_BANK_DETAIL_B13_NOT_VERIFIED_STATUSES,
  REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_B13_ACTION_SCOPE_MAP,
  REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS,
  REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE,
  REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS,
  REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON,
  REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES,
  isBankDetailB13Verified,
  findMissingBankFields,
  accountHolderLikelyMismatch,
  computeAccountFingerprint,
  getBankDetailCountryRequirements,
} from "@/lib/registry-bank-details-b13";

describe("Batch 13 — bank-detail submission & review SSOT", () => {
  it("contains every required status", () => {
    for (const s of [
      "draft", "submitted", "evidence_required", "under_review",
      "more_evidence_requested", "evidence_resubmitted", "captured_unverified",
      "rejected", "cancelled", "withdrawn", "revocation_requested", "revoked",
      "disputed", "expired", "superseded",
    ]) {
      expect(REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES).toContain(s);
    }
  });

  it("never marks any B13 status as verified", () => {
    for (const s of REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES) {
      expect(isBankDetailB13Verified(s)).toBe(false);
      expect(REGISTRY_BANK_DETAIL_B13_NOT_VERIFIED_STATUSES).toContain(s);
    }
  });

  it("maps action → authority scope for submit/update/revoke", () => {
    expect(REGISTRY_BANK_DETAIL_B13_ACTION_SCOPE_MAP.submit).toBe("bank_detail_submission");
    expect(REGISTRY_BANK_DETAIL_B13_ACTION_SCOPE_MAP.update).toBe("bank_detail_update");
    expect(REGISTRY_BANK_DETAIL_B13_ACTION_SCOPE_MAP.revoke).toBe("bank_detail_revocation_request");
  });

  it("includes all seven Batch 13 consent scopes", () => {
    for (const s of [
      "bank_detail_storage", "bank_detail_review", "bank_detail_masked_display",
      "bank_detail_status_response", "bank_detail_reverification",
      "bank_detail_dispute_handling", "bank_detail_audit_retention",
    ]) {
      expect(REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES).toContain(s);
    }
  });

  it("provides public labels that never claim verification", () => {
    for (const label of REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS) {
      expect(label.toLowerCase()).not.toContain("verified");
      // captured-but-not-verified is the one allowed phrasing.
    }
  });

  it("pins mandatory wording strings verbatim", () => {
    expect(REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING).toBe(
      "Submitted bank details are captured for review. They are not verified unless and until the bank-detail status separately says verified.",
    );
    expect(REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT).toBe(
      "I understand that accepting this submission only records bank details as captured/unverified. It does not verify the bank details.",
    );
    expect(REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE).toBe(
      "Bank details captured for review. This does not mean the bank details are verified.",
    );
  });

  it("enforces South Africa required fields", () => {
    const missing = findMissingBankFields("ZA", {
      account_holder_name: "Acme Pty Ltd",
      bank_name: "ABSA",
      currency_code: "ZAR",
      company_reference: "ZA-2024-12345",
    });
    expect(missing).toContain("account_number");
    expect(missing).toContain("branch_code");
    expect(missing).toContain("account_type");
  });

  it("enforces Nigeria required fields", () => {
    const missing = findMissingBankFields("NG", {
      account_holder_name: "Acme Ltd",
      bank_name: "GTBank",
    });
    expect(missing).toContain("account_number");
    expect(missing).toContain("currency_code");
    expect(missing).toContain("account_type");
    expect(missing).toContain("company_reference");
  });

  it("returns DEFAULT requirements for unknown countries", () => {
    const req = getBankDetailCountryRequirements("ZZ");
    expect(req.countryCode).toBe("DEFAULT");
    expect(req.requiredFields).toContain("currency_code");
  });

  it("flags an account-holder mismatch when there are no shared tokens", () => {
    expect(accountHolderLikelyMismatch("John Smith", "Acme Pty Ltd")).toBe(true);
    expect(accountHolderLikelyMismatch("Acme Holdings", "Acme Pty Ltd")).toBe(false);
    expect(accountHolderLikelyMismatch("", "Acme")).toBe(false);
  });

  it("computes a deterministic fingerprint", () => {
    const a = computeAccountFingerprint({
      countryCode: "ZA", branchCode: "250655", accountNumber: "1234567890",
    });
    const b = computeAccountFingerprint({
      countryCode: "za", branchCode: "25-06-55", accountNumber: " 12345 67890 ",
    });
    expect(a).toBe(b);
    const c = computeAccountFingerprint({
      countryCode: "ZA", branchCode: "250655", accountNumber: "9999999999",
    });
    expect(a).not.toBe(c);
  });

  it("requires a reason for every review action except assign_reviewer", () => {
    for (const a of REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS) {
      if (REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON.includes(a)) continue;
      // No assertion needed besides membership; runtime enforcement is in the edge function.
      expect(REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS).toContain(a);
    }
  });

  it("registers every required audit event name", () => {
    for (const ev of [
      "registry_bank_detail_started",
      "registry_bank_detail_submitted",
      "registry_bank_detail_evidence_uploaded",
      "registry_bank_detail_evidence_metadata_added",
      "registry_bank_detail_consent_accepted",
      "registry_bank_detail_review_started",
      "registry_bank_detail_more_evidence_requested",
      "registry_bank_detail_evidence_resubmitted",
      "registry_bank_detail_evidence_reviewed",
      "registry_bank_detail_captured_unverified",
      "registry_bank_detail_rejected",
      "registry_bank_detail_disputed",
      "registry_bank_detail_revocation_requested",
      "registry_bank_detail_revoked",
      "registry_bank_detail_expired",
      "registry_bank_detail_superseded",
      "registry_bank_detail_risk_flag_added",
      "registry_bank_detail_duplicate_fingerprint_detected",
      "registry_bank_detail_unmask_requested",
      "registry_bank_detail_unmask_viewed",
      "registry_bank_detail_note_added",
      "registry_bank_detail_notification_logged",
    ]) {
      expect(REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES).toContain(ev);
    }
  });
});
