import { describe, it, expect } from "vitest";
import {
  BATCH_19A_CLAIM_APPROVED_LIMITED_COPY,
  BATCH_19A_CLAIM_APPROVED_LIMITED_NEGATIVE_GRANTS,
  BATCH_19A_CLAIM_APPROVED_LIMITED_STATE,
  BATCH_19A_CLAIM_CONFLICT_STATE,
  BATCH_19A_CONFLICT_BLOCKED_ACTIONS,
  BATCH_19A_EVIDENCE_MAX_AGE_MONTHS,
  BATCH_19A_NEVER_PUBLICLY_SEARCHABLE_FIELDS,
  BATCH_19A_OUTREACH_RULES,
  BATCH_19A_PROFILE_HIDDEN_FROM_PUBLIC_AND_API,
  BATCH_19A_PROFILE_REQUIRES_PUBLIC_DISPLAY_APPROVAL,
  BATCH_19A_REPRESENTATIVE_PRE_AUTHORITY_FORBIDDEN,
  BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL,
  BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL,
  BATCH_19A_SAMPLE_ONLY_API_RULES,
  BATCH_19A_SAMPLE_ONLY_RECORDS,
  BATCH_19A_UNREGISTERED_USER_FLOW,
  isClaimantDirectEditForbidden,
  isEvidenceWithinFreshnessWindow,
  isImmediateClaimAllowed,
  isSampleOnlyRecord,
} from "@/lib/registry-client-decisions-19a";

describe("Batch 19A — Client claim/search/profile decisions", () => {
  it("listed officers/directors/members/proprietors/PSC can immediately start a claim", () => {
    for (const c of [
      "listed_officer",
      "listed_director",
      "listed_member",
      "listed_proprietor",
      "person_with_significant_control",
      "verified_company_domain_email_holder",
    ] as const) {
      expect(isImmediateClaimAllowed(c, false)).toBe(true);
    }
  });

  it("third-party advisers require mandate evidence", () => {
    expect(
      isImmediateClaimAllowed("third_party_adviser_with_mandate_evidence", false),
    ).toBe(false);
    expect(
      isImmediateClaimAllowed("third_party_adviser_with_mandate_evidence", true),
    ).toBe(true);
  });

  it("unlisted-person enquiries do not auto-start a claim", () => {
    expect(isImmediateClaimAllowed("unlisted_person_enquiry", true)).toBe(false);
  });

  it("unregistered-user flow gates evidence behind account + email verification", () => {
    const flow = BATCH_19A_UNREGISTERED_USER_FLOW;
    expect(flow.indexOf("account_required")).toBeLessThan(
      flow.indexOf("evidence_submitted"),
    );
    expect(flow.indexOf("email_verified")).toBeLessThan(
      flow.indexOf("evidence_submitted"),
    );
  });

  it("claim_approved_limited copy and negative grants are present", () => {
    expect(BATCH_19A_CLAIM_APPROVED_LIMITED_STATE).toBe("claim_approved_limited");
    expect(BATCH_19A_CLAIM_APPROVED_LIMITED_COPY).toMatch(/not verified/i);
    for (const g of [
      "does_not_confirm_authority_to_act",
      "does_not_verify_bank_details",
      "does_not_approve_api_sharing",
    ]) {
      expect(BATCH_19A_CLAIM_APPROVED_LIMITED_NEGATIVE_GRANTS).toContain(g);
    }
  });

  it("evidence older than 12 months requires refresh or exception", () => {
    expect(BATCH_19A_EVIDENCE_MAX_AGE_MONTHS).toBe(12);
    expect(isEvidenceWithinFreshnessWindow(11)).toBe(true);
    expect(isEvidenceWithinFreshnessWindow(13)).toBe(false);
  });

  it("competing claims enter claim_conflict_detected and block higher privileges", () => {
    expect(BATCH_19A_CLAIM_CONFLICT_STATE).toBe("claim_conflict_detected");
    for (const a of [
      "profile_changes",
      "bank_submission",
      "user_management",
      "api_sharing_consent",
    ]) {
      expect(BATCH_19A_CONFLICT_BLOCKED_ACTIONS).toContain(a);
    }
  });

  it("representatives pre-authority cannot bind the company", () => {
    for (const f of [
      "edit_company_profile_fields",
      "submit_bank_details",
      "manage_users",
      "consent_to_api_sharing",
      "represent_company_as_verified",
    ]) {
      expect(BATCH_19A_REPRESENTATIVE_PRE_AUTHORITY_FORBIDDEN).toContain(f);
    }
  });

  it("personal contact fields are never publicly searchable", () => {
    for (const f of ["personal_emails", "personal_phones", "raw_personal_addresses", "bank_details", "claim_evidence", "compliance_notes"]) {
      expect(BATCH_19A_NEVER_PUBLICLY_SEARCHABLE_FIELDS).toContain(f);
    }
  });

  it("officer names on the public profile require public_display_approved", () => {
    expect(BATCH_19A_PROFILE_REQUIRES_PUBLIC_DISPLAY_APPROVAL).toContain(
      "officer_director_or_member_names",
    );
  });

  it("bank details, claim evidence and compliance notes are hidden from public + API", () => {
    for (const f of [
      "bank_details",
      "claim_evidence",
      "compliance_notes",
      "do_not_contact_records",
    ]) {
      expect(BATCH_19A_PROFILE_HIDDEN_FROM_PUBLIC_AND_API).toContain(f);
    }
  });

  it("required public profile and sample record labels are pinned", () => {
    expect(BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL).toMatch(
      /Sourced company record/,
    );
    expect(BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL).toMatch(/Sample record/);
  });

  it("the five attached records are locked as sample_only", () => {
    expect(BATCH_19A_SAMPLE_ONLY_RECORDS).toHaveLength(5);
    for (const slug of BATCH_19A_SAMPLE_ONLY_RECORDS) {
      expect(isSampleOnlyRecord(slug)).toBe(true);
    }
    expect(isSampleOnlyRecord("some_production_company")).toBe(false);
  });

  it("sample_only records are excluded from production API and report verified_by_izenzo=false in sandbox", () => {
    expect(BATCH_19A_SAMPLE_ONLY_API_RULES.production_api).toBe("excluded");
    expect(BATCH_19A_SAMPLE_ONLY_API_RULES.sandbox_verified_by_izenzo).toBe(false);
    expect(BATCH_19A_SAMPLE_ONLY_API_RULES.payment_status_usable_verified).toBe(
      false,
    );
  });

  it("claimant cannot directly edit protected registry fields", () => {
    for (const f of [
      "company_name",
      "registration_number",
      "vat_number",
      "legal_form",
      "officers",
      "members",
      "registered_address",
      "bank_details",
    ]) {
      expect(isClaimantDirectEditForbidden(f)).toBe(true);
    }
    expect(isClaimantDirectEditForbidden("phone_number")).toBe(false);
  });

  it("SMS and WhatsApp outreach remain disabled in Phase 1", () => {
    expect(BATCH_19A_OUTREACH_RULES.sms).toBe("disabled_in_phase_1");
    expect(BATCH_19A_OUTREACH_RULES.whatsapp).toBe("disabled_in_phase_1");
    expect(BATCH_19A_OUTREACH_RULES.do_not_contact).toMatch(/immediate_suppression/);
  });
});
