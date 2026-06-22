// Batch 28 — Bank-detail capture, multi-account and verification operating rules tests.
import { describe, it, expect } from "vitest";
import {
  evaluateBankSubmitGate,
  BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS,
  BANK_SUBMIT_BLOCKING_AUTHORITY_STATES,
  requiredBankFields,
  detectBankFieldGroup,
  validateBankFields,
  BANK_FORBIDDEN_FIELD_NG_BVN,
  BANK_ACCOUNT_PURPOSE_LABELS,
  BANK_V1_MAX_ACTIVE_ACCOUNTS,
  BANK_V1_OVER_MAX_REQUIRES_ROLES,
  evaluateNewBankAccount,
  BANK_THIRD_PARTY_DEFAULT_STATE,
  BANK_THIRD_PARTY_API_RAW_BLOCKED_BY_DEFAULT,
  evaluateThirdPartyAccount,
  BANK_BASE_REQUIRED_EVIDENCE,
  isBankStatusGatedByEvidenceReview,
  evaluateUnmaskRequest,
  BANK_UNMASKED_REQUIRES_AAL2,
  isBankStatusVerified,
  BANK_COMPANY_CONFIRMED_IS_VERIFIED,
  BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED,
  evaluateManualVerification,
  BANK_MANUAL_VERIFICATION_LABEL_API,
  BANK_MANUAL_VERIFICATION_DEMO_COPY,
  bankVerificationValidityDays,
  BANK_MANUAL_VERIFICATION_VALIDITY_DAYS,
  BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS,
  BANK_IMMEDIATE_EXPIRY_TRIGGERS,
  BANK_NON_USABLE_STATES,
  BANK_NON_USABLE_UI_WORDING,
  BANK_NON_USABLE_API_RESPONSE,
  evaluatePaymentStatusGate,
  PAYMENT_STATUS_API_SAFE_FIELDS,
  PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT,
  BANK_API_RAW_BLOCKED_BY_DEFAULT,
  BANK_OPERATING_AUDIT_EVENTS,
} from "@/lib/registry-bank-operating-rules";

const baseUser = {
  authenticated: true,
  email_verified: true,
  authority_active: true,
  authority_state: "active",
  authority_scopes: ["submit_bank_details"],
  authority_conditional: false,
  is_platform_admin: false,
  admin_assisted_evidence_present: false,
  admin_assisted_reason: null,
  is_claim_only: false,
  user_kind: "registered_user" as const,
  company_suspended: false,
};

describe("Batch 28 — submitter gate", () => {
  it("claim-approved-only user cannot submit bank details", () => {
    const r = evaluateBankSubmitGate({ ...baseUser, is_claim_only: true });
    expect(r).toEqual({ allowed: false, reason: "claim_only_blocked" });
    expect(BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS).toBe(false);
  });
  it("authority_active with bank_submit can submit", () => {
    expect(evaluateBankSubmitGate({ ...baseUser, authority_scopes: ["bank_submit"] }))
      .toEqual({ allowed: true, mode: "user" });
    expect(evaluateBankSubmitGate(baseUser)).toEqual({ allowed: true, mode: "user" });
  });
  it("blocks expired/disputed/revoked authority", () => {
    for (const s of BANK_SUBMIT_BLOCKING_AUTHORITY_STATES) {
      expect(evaluateBankSubmitGate({ ...baseUser, authority_state: s }))
        .toEqual({ allowed: false, reason: "authority_state_blocking" });
    }
  });
  it("conditional authority only permits draft", () => {
    expect(evaluateBankSubmitGate({ ...baseUser, authority_conditional: true }))
      .toEqual({ allowed: true, mode: "draft_only" });
  });
  it("admin-assisted requires evidence and reason", () => {
    expect(evaluateBankSubmitGate({ ...baseUser, is_platform_admin: true }))
      .toEqual({ allowed: false, reason: "admin_assisted_requires_evidence_and_reason" });
    expect(evaluateBankSubmitGate({
      ...baseUser,
      is_platform_admin: true,
      admin_assisted_evidence_present: true,
      admin_assisted_reason: "client_request",
    })).toEqual({ allowed: true, mode: "admin_assisted" });
  });
  it("unregistered / unverified blocked", () => {
    expect(evaluateBankSubmitGate({ ...baseUser, authenticated: false }))
      .toEqual({ allowed: false, reason: "must_register" });
    expect(evaluateBankSubmitGate({ ...baseUser, email_verified: false }))
      .toEqual({ allowed: false, reason: "must_verify_email" });
  });
  it("missing bank scope blocked", () => {
    expect(evaluateBankSubmitGate({ ...baseUser, authority_scopes: ["edit_profile_limited_non_sensitive"] }))
      .toEqual({ allowed: false, reason: "authority_missing_bank_scope" });
  });
});

describe("Batch 28 — country bank fields", () => {
  it("detects field group", () => {
    expect(detectBankFieldGroup("ZA")).toBe("za");
    expect(detectBankFieldGroup("ng")).toBe("ng");
    expect(detectBankFieldGroup("GB")).toBe("other");
  });
  it("enforces ZA required fields", () => {
    const r = validateBankFields({ group: "za", fields: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("branch_code");
  });
  it("enforces NG required fields and blocks BVN unless approved", () => {
    const missing = validateBankFields({ group: "ng", fields: {} });
    expect(missing.ok).toBe(false);
    const blocked = validateBankFields({
      group: "ng",
      fields: {
        bank_name: "GTB",
        account_holder: "Acme",
        account_number: "0001112223",
        bank_code_or_nibss_identifier: "058",
        currency: "NGN",
        proof_document: "doc://x",
        [BANK_FORBIDDEN_FIELD_NG_BVN]: "22222222222",
      },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.forbidden).toContain("bvn");
    const approved = validateBankFields({
      group: "ng",
      bvn_separately_approved: true,
      fields: {
        bank_name: "GTB",
        account_holder: "Acme",
        account_number: "0001112223",
        bank_code_or_nibss_identifier: "058",
        currency: "NGN",
        proof_document: "doc://x",
        bvn: "22222222222",
      },
    });
    expect(approved.ok).toBe(true);
  });
  it("enforces other-country required fields", () => {
    expect(requiredBankFields("other")).toContain("country");
    const r = validateBankFields({
      group: "other",
      fields: {
        bank_name: "X",
        account_holder: "Y",
        account_number_or_iban: "GB11",
        branch_or_sort_or_routing_code: "11",
        currency: "GBP",
        country: "GB",
        proof_document: "doc",
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("Batch 28 — multiple accounts", () => {
  const base = { id: "a", status: "submitted", is_primary: false, currency: "ZAR", payment_route: null, purpose: "operating" as const, is_third_party: false };
  it("allows multiple accounts up to V1 max", () => {
    expect(evaluateNewBankAccount({
      existing_active: [base, { ...base, id: "b" }],
      new_account: { ...base, id: "c" },
      dual_approval_present: false,
    })).toEqual({ ok: true });
  });
  it("requires dual approval beyond 3", () => {
    const three = [base, { ...base, id: "b" }, { ...base, id: "c" }];
    expect(evaluateNewBankAccount({
      existing_active: three,
      new_account: { ...base, id: "d" },
      dual_approval_present: false,
    })).toEqual({ ok: false, reason: "exceeds_v1_max_active_without_dual_approval" });
    expect(evaluateNewBankAccount({
      existing_active: three,
      new_account: { ...base, id: "d" },
      dual_approval_present: true,
    })).toEqual({ ok: true });
    expect(BANK_V1_MAX_ACTIVE_ACCOUNTS).toBe(3);
    expect(BANK_V1_OVER_MAX_REQUIRES_ROLES).toEqual(["platform_admin", "compliance_owner"]);
  });
  it("requires a purpose for additional accounts", () => {
    expect(evaluateNewBankAccount({
      existing_active: [base],
      new_account: { ...base, id: "b", purpose: null },
      dual_approval_present: false,
    })).toEqual({ ok: false, reason: "purpose_required_for_additional_account" });
  });
  it("primary uniqueness per currency/route", () => {
    expect(evaluateNewBankAccount({
      existing_active: [{ ...base, is_primary: true }],
      new_account: { ...base, id: "b", is_primary: true },
      dual_approval_present: false,
    })).toEqual({ ok: false, reason: "primary_account_conflict_currency_route" });
  });
  it("purpose labels closed list", () => {
    expect(BANK_ACCOUNT_PURPOSE_LABELS).toEqual([
      "operating", "escrow", "export", "project", "subscription", "settlement",
    ]);
  });
});

describe("Batch 28 — third-party accounts", () => {
  it("default state is pending review and API raw blocked", () => {
    expect(BANK_THIRD_PARTY_DEFAULT_STATE).toBe("third_party_account_pending_review");
    expect(BANK_THIRD_PARTY_API_RAW_BLOCKED_BY_DEFAULT).toBe(true);
  });
  it("cannot be usable without all evidence and compliance approval", () => {
    expect(evaluateThirdPartyAccount({ evidence_present: [], compliance_owner_approved: false }).usable).toBe(false);
    expect(evaluateThirdPartyAccount({
      evidence_present: [
        "third_party_mandate",
        "contract_or_payment_instruction",
        "beneficial_owner_or_relationship_explanation",
        "board_or_member_resolution_where_applicable",
        "compliance_owner_approval",
      ],
      compliance_owner_approved: true,
    }).usable).toBe(true);
  });
});

describe("Batch 28 — evidence and statuses", () => {
  it("base required evidence pinned", () => {
    expect(BANK_BASE_REQUIRED_EVIDENCE).toContain("consent_declaration");
  });
  it("statuses gated by evidence review", () => {
    expect(isBankStatusGatedByEvidenceReview("manually_checked")).toBe(true);
    expect(isBankStatusGatedByEvidenceReview("provider_verified")).toBe(true);
    expect(isBankStatusGatedByEvidenceReview("submitted")).toBe(false);
  });
  it("company_confirmed is not verified and manual_checked is not provider_verified", () => {
    expect(BANK_COMPANY_CONFIRMED_IS_VERIFIED).toBe(false);
    expect(BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED).toBe(false);
    expect(isBankStatusVerified("company_confirmed")).toBe(false);
    expect(isBankStatusVerified("manually_checked")).toBe(false);
    expect(isBankStatusVerified("submitted")).toBe(false);
    expect(isBankStatusVerified("provider_verified")).toBe(true);
    expect(isBankStatusVerified("bank_confirmed")).toBe(true);
    expect(isBankStatusVerified("institution_confirmed")).toBe(true);
    expect(isBankStatusVerified("manual_bank_check_complete")).toBe(true);
  });
});

describe("Batch 28 — unmask access", () => {
  it("requires allowed role, AAL2 and reason", () => {
    expect(BANK_UNMASKED_REQUIRES_AAL2).toBe(true);
    expect(evaluateUnmaskRequest({ actor_role: "public", aal2: true, reason_code: "x", is_viewing_own_account: false }))
      .toEqual({ allowed: false, reason: "role_not_permitted" });
    expect(evaluateUnmaskRequest({ actor_role: "compliance_owner", aal2: false, reason_code: "x", is_viewing_own_account: false }))
      .toEqual({ allowed: false, reason: "aal2_required" });
    expect(evaluateUnmaskRequest({ actor_role: "compliance_owner", aal2: true, reason_code: null, is_viewing_own_account: false }))
      .toEqual({ allowed: false, reason: "reason_required" });
    expect(evaluateUnmaskRequest({ actor_role: "compliance_owner", aal2: true, reason_code: "investigation", is_viewing_own_account: false }))
      .toEqual({ allowed: true, must_audit: true });
  });
});

describe("Batch 28 — manual verification", () => {
  it("requires compliance_owner + platform_admin decision + evidence", () => {
    const evidence = [
      "bank_letter_or_statement", "authority_evidence", "account_holder_match", "reviewer_checklist", "expiry_date",
    ];
    expect(evaluateManualVerification({ evidence_present: [], compliance_owner_approved: true, platform_admin_decision_recorded: true }).allowed).toBe(false);
    expect(evaluateManualVerification({ evidence_present: evidence, compliance_owner_approved: false, platform_admin_decision_recorded: true }))
      .toEqual({ allowed: false, reason: "needs_compliance_owner" });
    expect(evaluateManualVerification({ evidence_present: evidence, compliance_owner_approved: true, platform_admin_decision_recorded: false }))
      .toEqual({ allowed: false, reason: "needs_platform_admin_decision" });
    const ok = evaluateManualVerification({ evidence_present: evidence, compliance_owner_approved: true, platform_admin_decision_recorded: true });
    expect(ok).toEqual({ allowed: true, api_label: BANK_MANUAL_VERIFICATION_LABEL_API });
  });
  it("demo wording is the canonical safe label", () => {
    expect(BANK_MANUAL_VERIFICATION_DEMO_COPY).toContain("no live provider check");
  });
});

describe("Batch 28 — validity / expiry", () => {
  it("manual = 90 days, provider/bank/institution = 180 days", () => {
    expect(BANK_MANUAL_VERIFICATION_VALIDITY_DAYS).toBe(90);
    expect(BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS).toBe(180);
    expect(bankVerificationValidityDays("compliance_approved_manual_verification")).toBe(90);
    expect(bankVerificationValidityDays("provider_confirmed")).toBe(180);
    expect(bankVerificationValidityDays("bank_confirmed")).toBe(180);
    expect(bankVerificationValidityDays("institution_confirmed")).toBe(180);
  });
  it("immediate expiry triggers pinned", () => {
    for (const t of ["dispute", "account_change", "company_authority_revocation", "adverse_bank_notification", "failed_payment", "material_correction_request"]) {
      expect((BANK_IMMEDIATE_EXPIRY_TRIGGERS as readonly string[])).toContain(t);
    }
  });
});

describe("Batch 28 — non-usable states", () => {
  it("UI and API wording pinned", () => {
    expect(BANK_NON_USABLE_STATES).toEqual(["pending", "disputed", "revoked", "expired", "failed"]);
    expect(BANK_NON_USABLE_UI_WORDING.pending).toContain("review pending");
    expect(BANK_NON_USABLE_UI_WORDING.disputed).toContain("under dispute");
    expect(BANK_NON_USABLE_UI_WORDING.revoked).toContain("revoked");
    expect(BANK_NON_USABLE_UI_WORDING.expired).toContain("re-verification required");
    expect(BANK_NON_USABLE_API_RESPONSE.disputed).toBe("not_usable_disputed");
    expect(BANK_NON_USABLE_API_RESPONSE.expired).toBe("re_verification_required");
    expect(BANK_NON_USABLE_API_RESPONSE.failed).toBe("failed_not_usable");
  });
});

describe("Batch 28 — payment-status API gate", () => {
  const okInput = {
    bank_status: "provider_verified",
    is_expired: false, is_disputed: false, is_revoked: false, is_pending: false,
    required_evidence_present: true,
    manual_compliance_approved_if_manual: true,
    authority_active_with_bank_or_api_consent: true,
    business_decision_allows_api_payment_status: true,
  };
  it("usable only for approved verification states", () => {
    expect(evaluatePaymentStatusGate(okInput)).toEqual({ usable: true });
    expect(evaluatePaymentStatusGate({ ...okInput, bank_status: "company_confirmed" }))
      .toEqual({ usable: false, reason: "status_not_approved_verification" });
    expect(evaluatePaymentStatusGate({ ...okInput, bank_status: "manually_checked" }))
      .toEqual({ usable: false, reason: "status_not_approved_verification" });
  });
  it("non-usable states block", () => {
    expect(evaluatePaymentStatusGate({ ...okInput, is_expired: true }).usable).toBe(false);
    expect(evaluatePaymentStatusGate({ ...okInput, is_disputed: true }).usable).toBe(false);
    expect(evaluatePaymentStatusGate({ ...okInput, is_revoked: true }).usable).toBe(false);
    expect(evaluatePaymentStatusGate({ ...okInput, is_pending: true }).usable).toBe(false);
  });
  it("manual without compliance approval blocked", () => {
    expect(evaluatePaymentStatusGate({ ...okInput, bank_status: "manual_bank_check_complete", manual_compliance_approved_if_manual: false }))
      .toEqual({ usable: false, reason: "manual_requires_compliance_approval" });
  });
  it("authority/consent and business decision gates enforced", () => {
    expect(evaluatePaymentStatusGate({ ...okInput, authority_active_with_bank_or_api_consent: false }).usable).toBe(false);
    expect(evaluatePaymentStatusGate({ ...okInput, business_decision_allows_api_payment_status: false }).usable).toBe(false);
  });
  it("API safe-field set is masked-only and raw blocked", () => {
    expect(PAYMENT_STATUS_API_SAFE_FIELDS).toContain("masked_account_identifier");
    expect(PAYMENT_STATUS_API_SAFE_FIELDS as readonly string[]).not.toContain("account_number");
    expect(PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT).toBe(true);
    expect(BANK_API_RAW_BLOCKED_BY_DEFAULT).toBe(true);
  });
});

describe("Batch 28 — audit events", () => {
  it("canonical audit names present", () => {
    for (const n of [
      "registry_bank_submit_gate_evaluated",
      "registry_bank_account_created",
      "registry_bank_third_party_pending_review",
      "registry_bank_manual_verification_recorded",
      "registry_bank_unmask_access_granted",
      "registry_bank_payment_status_gate_evaluated",
    ]) {
      expect((BANK_OPERATING_AUDIT_EVENTS as readonly string[])).toContain(n);
    }
  });
});
