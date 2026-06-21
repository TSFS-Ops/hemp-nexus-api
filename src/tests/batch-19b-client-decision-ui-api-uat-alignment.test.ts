import { describe, it, expect } from "vitest";
import {
  BATCH_19B_PUBLIC_SEARCH_SAFE_MATCH_REASONS,
  BATCH_19B_PUBLIC_SEARCH_FORBIDDEN_MATCH_REASONS,
  BATCH_19B_OFFICER_NAME_SEARCH_RULES,
  BATCH_19B_REQUIRED_PUBLIC_PROFILE_LABEL,
  BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL,
  BATCH_19B_CLAIM_APPROVED_LIMITED_COPY,
  BATCH_19B_CLAIM_UI_STATES,
  BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK,
  BATCH_19B_EVIDENCE_REFRESH_LABEL,
  BATCH_19B_REPRESENTATIVE_BLOCKED_UI_ACTIONS,
  BATCH_19B_CLAIM_CONFLICT_NEUTRAL_COPY,
  BATCH_19B_MISSING_COMPANY_NO_AUTO_PUBLIC_PROFILE_COPY,
  BATCH_19B_CORRECTION_REVIEW_GATED_COPY,
  BATCH_19B_CORRECTION_PROTECTED_FIELDS,
  BATCH_19B_OUTREACH_UI_RULES,
  BATCH_19B_SMS_DISABLED_COPY,
  BATCH_19B_WHATSAPP_DISABLED_COPY,
  BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY,
  BATCH_19B_SAMPLE_ONLY_API_CONTRACT,
  BATCH_19B_API_MUST_NOT_IMPLY,
  BATCH_19B_PORTAL_LIMITED_CONNECTION_COPY,
  BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS,
  BATCH_19B_SAMPLE_ONLY_RECORDS,
  batch19bIsSampleOnly,
  batch19bSandboxSampleOnlyResponse,
  batch19bIsForbiddenPublicMatchReason,
} from "@/lib/registry-client-decisions-19b";

describe("Batch 19B — client decision UI/API/UAT alignment", () => {
  it("public search safe match reasons exclude personal/bank/evidence", () => {
    for (const r of BATCH_19B_PUBLIC_SEARCH_FORBIDDEN_MATCH_REASONS) {
      expect(
        (BATCH_19B_PUBLIC_SEARCH_SAFE_MATCH_REASONS as readonly string[]).includes(r),
      ).toBe(false);
      expect(batch19bIsForbiddenPublicMatchReason(r)).toBe(true);
    }
  });

  it("officer-name search is blocked unless logged-in + public-display approved", () => {
    expect(BATCH_19B_OFFICER_NAME_SEARCH_RULES.unrestricted_public).toBe(false);
    expect(BATCH_19B_OFFICER_NAME_SEARCH_RULES.logged_in_only).toBe(true);
    expect(
      BATCH_19B_OFFICER_NAME_SEARCH_RULES.requires_public_display_approval,
    ).toBe(true);
  });

  it("public profile required label is the sourced-record line", () => {
    expect(BATCH_19B_REQUIRED_PUBLIC_PROFILE_LABEL).toMatch(
      /Sourced company record/i,
    );
    expect(BATCH_19B_REQUIRED_PUBLIC_PROFILE_LABEL).toMatch(
      /not independently verified by Izenzo/i,
    );
  });

  it("sample-only required label is set", () => {
    expect(BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL).toMatch(/Sample record/i);
    expect(BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL).toMatch(/Not independently verified/i);
  });

  it("five sample_only records are locked", () => {
    expect(BATCH_19B_SAMPLE_ONLY_RECORDS.length).toBe(5);
    for (const slug of [
      "bullion_bathrooms_nigeria",
      "dangote_fertiliser_limited",
      "harith_holdings",
      "laurium_capital",
      "starfair_162",
    ]) {
      expect(batch19bIsSampleOnly(slug)).toBe(true);
    }
    expect(batch19bIsSampleOnly("real_company_123")).toBe(false);
  });

  it("sample_only is excluded from production API", () => {
    expect(BATCH_19B_SAMPLE_ONLY_API_CONTRACT.production_api).toBe("excluded");
  });

  it("sample_only sandbox returns verified_by_izenzo=false", () => {
    const r = batch19bSandboxSampleOnlyResponse("dangote_fertiliser_limited");
    expect(r.verified_by_izenzo).toBe(false);
    expect(r.readiness_state).toBe("sample_only");
  });

  it("claim UI renders claim_approved_limited safe wording", () => {
    expect(BATCH_19B_CLAIM_APPROVED_LIMITED_COPY).toMatch(
      /Claim reviewed - claimant connection accepted/i,
    );
    expect(BATCH_19B_CLAIM_APPROVED_LIMITED_COPY).toMatch(
      /not verified by this claim approval/i,
    );
  });

  it("claim approval does not unlock authority/bank/API UI", () => {
    for (const x of [
      "authority_ui",
      "bank_detail_submission_ui",
      "api_sharing_ui",
    ]) {
      expect(
        (BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK as readonly string[]).includes(x),
      ).toBe(true);
    }
  });

  it("claim UI exposes all client states", () => {
    for (const s of [
      "more_information_required",
      "approved_limited",
      "rejected",
      "evidence_submitted",
    ]) {
      expect(
        (BATCH_19B_CLAIM_UI_STATES as readonly string[]).includes(s),
      ).toBe(true);
    }
  });

  it("evidence older than 12 months renders refresh-required label", () => {
    expect(BATCH_19B_EVIDENCE_REFRESH_LABEL).toMatch(/older than 12 months/i);
    expect(BATCH_19B_EVIDENCE_REFRESH_LABEL).toMatch(/refresh required/i);
  });

  it("representative pre-authority blocks bank/profile/users/api", () => {
    for (const x of [
      "bank_detail_submission",
      "profile_edits",
      "user_management",
      "api_sharing_consent",
    ]) {
      expect(
        (BATCH_19B_REPRESENTATIVE_BLOCKED_UI_ACTIONS as readonly string[]).includes(x),
      ).toBe(true);
    }
  });

  it("claim conflict copy is neutral and does not reveal other claimant", () => {
    expect(BATCH_19B_CLAIM_CONFLICT_NEUTRAL_COPY).toMatch(/Another claim/i);
    expect(BATCH_19B_CLAIM_CONFLICT_NEUTRAL_COPY).not.toMatch(/email|phone|name of/i);
  });

  it("missing-company copy says no public profile is auto-created", () => {
    expect(
      BATCH_19B_MISSING_COMPANY_NO_AUTO_PUBLIC_PROFILE_COPY,
    ).toMatch(/does not create a public profile/i);
  });

  it("correction copy says request is review-gated", () => {
    expect(BATCH_19B_CORRECTION_REVIEW_GATED_COPY).toMatch(
      /does not immediately change/i,
    );
    expect(BATCH_19B_CORRECTION_REVIEW_GATED_COPY).toMatch(/reviewed first/i);
  });

  it("correction-protected fields include bank/registration/officers", () => {
    for (const f of [
      "bank_details",
      "registration_number",
      "officers",
      "registered_address",
    ]) {
      expect(
        (BATCH_19B_CORRECTION_PROTECTED_FIELDS as readonly string[]).includes(f),
      ).toBe(true);
    }
  });

  it("SMS and WhatsApp are disabled in Phase 1", () => {
    expect(BATCH_19B_OUTREACH_UI_RULES.sms).toBe("disabled_in_phase_1");
    expect(BATCH_19B_OUTREACH_UI_RULES.whatsapp).toBe("disabled_in_phase_1");
    expect(BATCH_19B_SMS_DISABLED_COPY).toMatch(/disabled in Phase 1/i);
    expect(BATCH_19B_WHATSAPP_DISABLED_COPY).toMatch(/disabled in Phase 1/i);
  });

  it("do-not-contact suppression wording is set", () => {
    expect(BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY).toMatch(/suppressed/i);
    expect(BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY).toMatch(/do-not-contact/i);
  });

  it("API must not imply verification by claim/authority/bank/source", () => {
    for (const x of [
      "sourced_data_independently_verified",
      "claim_approval_verifies_company_profile",
      "authority_approval_verifies_company_profile",
      "bank_detail_capture_verifies_bank_details",
    ]) {
      expect((BATCH_19B_API_MUST_NOT_IMPLY as readonly string[]).includes(x)).toBe(true);
    }
  });

  it("portal limited-connection wording is set", () => {
    expect(BATCH_19B_PORTAL_LIMITED_CONNECTION_COPY).toMatch(
      /Limited connection accepted/i,
    );
  });

  it("UAT pack includes all client-decision scenarios", () => {
    expect(BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS.length).toBeGreaterThanOrEqual(14);
    for (const s of [
      "sample_only_production_api_exclusion",
      "claim_approved_limited_safe_copy",
      "officer_name_public_search_blocked_unless_approved",
      "evidence_older_than_12_months_refresh_required",
      "sms_disabled_phase_1",
      "whatsapp_disabled_phase_1",
      "do_not_contact_suppresses_outreach",
    ]) {
      expect(
        (BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS as readonly string[]).includes(s),
      ).toBe(true);
    }
  });
});
