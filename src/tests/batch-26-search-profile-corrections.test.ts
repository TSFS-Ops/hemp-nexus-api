// Batch 26 — Search, typeahead, public profile and corrections rules tests.
import { describe, it, expect } from "vitest";
import {
  classifyField,
  isFieldSearchableByAudience,
  OFFICER_PUBLIC_SEARCH_ENABLED,
  EMAIL_PUBLIC_SEARCH_ENABLED,
  PHONE_PUBLIC_SEARCH_ENABLED,
  isOfficerLoggedInSearchAllowed,
  isOfficerApiSearchAllowed,
  OFFICER_MATCH_CAUTION,
  PARTIAL_MATCH_MIN_CHARS,
  TYPO_MIN_CONFIDENCE,
  PUBLIC_MIN_CONFIDENCE,
  isPartialMatchAllowed,
  shouldShowFuzzyToPublic,
  shouldShowTypoMatch,
  rankMatch,
  PUBLIC_SAFE_MATCH_REASONS,
  ADMIN_ONLY_MATCH_REASONS,
  isPublicSafeMatchReason,
  NO_RESULT_WORDING,
  NO_RESULT_QUEUE_EVENT,
  NO_RESULT_FORBIDDEN_SIDE_EFFECTS,
  noResultRequestRequiresLogin,
  PUBLIC_PROFILE_FIELDS,
  MASKED_OR_LOGGED_IN_PROFILE_FIELDS,
  ADMIN_ONLY_PROFILE_FIELDS,
  EXCLUDED_PROFILE_FIELDS,
  profileFieldAudience,
  PROFILE_WORDING,
  SENSITIVE_CORRECTION_FIELDS,
  correctionReviewerRoleFor,
  CORRECTION_NEVER_AUTO_PUBLISHES,
  CORRECTION_USES_VERSIONED_HISTORY,
  CORRECTION_OLD_VALUES_ADMIN_ONLY_BY_DEFAULT,
  correctionBlocksPublicWhileDisputed,
  REGISTRY_SEARCH_PROFILE_AUDIT_EVENTS,
} from "@/lib/registry-search-profile-rules";

describe("batch 26 — search field classification", () => {
  it("classifies public-searchable fields correctly", () => {
    expect(classifyField("company_legal_name")).toBe("public_searchable");
    expect(classifyField("registration_number")).toBe("public_searchable");
    expect(classifyField("country_code")).toBe("public_searchable");
  });
  it("keeps officers/UBO/personal contacts admin-only", () => {
    for (const f of ["officers_directors", "ubo", "personal_email", "personal_phone"]) {
      expect(classifyField(f)).toBe("admin_only");
    }
  });
  it("keeps raw bank, identity docs, secrets excluded", () => {
    for (const f of ["raw_bank_details", "identity_documents", "passwords_secrets", "private_notes", "restricted_personal_data"]) {
      expect(classifyField(f)).toBe("excluded");
      expect(isFieldSearchableByAudience(f, "public")).toBe(false);
      expect(isFieldSearchableByAudience(f, "admin")).toBe(false);
      expect(isFieldSearchableByAudience(f, "api")).toBe(false);
    }
  });
  it("audience gating respects classification", () => {
    expect(isFieldSearchableByAudience("company_legal_name", "public")).toBe(true);
    expect(isFieldSearchableByAudience("broader_address", "public")).toBe(false);
    expect(isFieldSearchableByAudience("broader_address", "logged_in")).toBe(true);
    expect(isFieldSearchableByAudience("officers_directors", "logged_in")).toBe(false);
    expect(isFieldSearchableByAudience("officers_directors", "admin")).toBe(true);
  });
});

describe("batch 26 — officer / email / phone search restrictions", () => {
  it("disables public officer / email / phone search", () => {
    expect(OFFICER_PUBLIC_SEARCH_ENABLED).toBe(false);
    expect(EMAIL_PUBLIC_SEARCH_ENABLED).toBe(false);
    expect(PHONE_PUBLIC_SEARCH_ENABLED).toBe(false);
  });
  it("requires every officer logged-in gate to pass", () => {
    const all = {
      source_licence_permits: true,
      field_group_manually_reviewed: true,
      field_group_approved_for_logged_in: true,
      privacy_or_compliance_hold_present: false,
    };
    expect(isOfficerLoggedInSearchAllowed(all)).toBe(true);
    expect(isOfficerLoggedInSearchAllowed({ ...all, source_licence_permits: false })).toBe(false);
    expect(isOfficerLoggedInSearchAllowed({ ...all, field_group_manually_reviewed: false })).toBe(false);
    expect(isOfficerLoggedInSearchAllowed({ ...all, field_group_approved_for_logged_in: false })).toBe(false);
    expect(isOfficerLoggedInSearchAllowed({ ...all, privacy_or_compliance_hold_present: true })).toBe(false);
  });
  it("requires compliance_owner approval for officer API search", () => {
    expect(isOfficerApiSearchAllowed({
      special_approval: true,
      lawful_permitted_use_basis: true,
      client_contract_scope: true,
      compliance_owner_approved: false,
    })).toBe(false);
  });
  it("ships the officer-match caution wording", () => {
    expect(OFFICER_MATCH_CAUTION).toMatch(/incomplete or stale/);
  });
});

describe("batch 26 — partial / typo / abbreviation matching", () => {
  it("pins thresholds", () => {
    expect(PARTIAL_MATCH_MIN_CHARS).toBe(3);
    expect(TYPO_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.85);
    expect(PUBLIC_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.75);
  });
  it("requires >= 3 chars for partial matches and only on name fields", () => {
    expect(isPartialMatchAllowed("company_legal_name", "ab")).toBe(false);
    expect(isPartialMatchAllowed("company_legal_name", "abc")).toBe(true);
    expect(isPartialMatchAllowed("trading_name", "abc")).toBe(true);
    expect(isPartialMatchAllowed("raw_bank_details", "abcdef")).toBe(false);
    expect(isPartialMatchAllowed("personal_email", "abcdef")).toBe(false);
  });
  it("hides fuzzy results below 75% from public users", () => {
    expect(shouldShowFuzzyToPublic(0.74)).toBe(false);
    expect(shouldShowFuzzyToPublic(0.76)).toBe(true);
  });
  it("hides typo matches below 85% confidence", () => {
    expect(shouldShowTypoMatch(0.84)).toBe(false);
    expect(shouldShowTypoMatch(0.86)).toBe(true);
  });
  it("ranks exact identifier matches above fuzzy name matches", () => {
    expect(rankMatch("exact_identifier")).toBeLessThan(rankMatch("fuzzy_name"));
  });
});

describe("batch 26 — safe match reasons", () => {
  it("public allow-list contains only the seven approved labels", () => {
    expect(PUBLIC_SAFE_MATCH_REASONS).toEqual([
      "Matched company name",
      "Matched trading name",
      "Matched registration number",
      "Matched jurisdiction",
      "Matched approved alias",
      "Similar name - check details",
      "Matched approved public identifier",
    ]);
  });
  it("admin-only reasons never overlap public allow-list", () => {
    for (const a of ADMIN_ONLY_MATCH_REASONS) {
      expect(PUBLIC_SAFE_MATCH_REASONS).not.toContain(a);
    }
  });
  it("isPublicSafeMatchReason rejects admin-only labels", () => {
    expect(isPublicSafeMatchReason("Matched company name")).toBe(true);
    expect(isPublicSafeMatchReason("Officer / person match")).toBe(false);
    expect(isPublicSafeMatchReason("Email match")).toBe(false);
    expect(isPublicSafeMatchReason("Import batch")).toBe(false);
  });
});

describe("batch 26 — no-result workflow", () => {
  it("uses the exact wording", () => {
    expect(NO_RESULT_WORDING).toBe(
      "No matching company found in the currently searchable registry.",
    );
  });
  it("emits the admin queue event only", () => {
    expect(NO_RESULT_QUEUE_EVENT).toBe("company_addition_requested");
  });
  it("forbids creating public records, claims, POIs or API-ready records", () => {
    for (const s of [
      "create_public_company_record",
      "create_claim",
      "create_poi",
      "create_api_ready_record",
    ]) {
      expect(NO_RESULT_FORBIDDEN_SIDE_EFFECTS).toContain(s);
    }
  });
  it("requires login for submitting a request", () => {
    expect(noResultRequestRequiresLogin()).toBe(true);
  });
});

describe("batch 26 — public profile visibility", () => {
  it("places the report/correction link on the public profile", () => {
    expect(PUBLIC_PROFILE_FIELDS).toContain("report_correction_link");
  });
  it("keeps officers/UBO/disputes/corrections admin-only", () => {
    for (const f of ["officers", "ubo", "disputes", "corrections", "confidence_scores", "import_batch", "evidence", "internal_notes"]) {
      expect(ADMIN_ONLY_PROFILE_FIELDS).toContain(f);
      expect(profileFieldAudience(f)).toBe("admin");
    }
  });
  it("excludes raw bank details, identity documents, private notes, secrets from any rendering", () => {
    for (const f of EXCLUDED_PROFILE_FIELDS) {
      expect(profileFieldAudience(f)).toBe("excluded");
    }
  });
  it("masked/logged-in fields are not public", () => {
    for (const f of MASKED_OR_LOGGED_IN_PROFILE_FIELDS) {
      expect(profileFieldAudience(f)).toBe("logged_in");
    }
  });
  it("ships the four client-supplied wording strings", () => {
    expect(PROFILE_WORDING.not_independently_verified).toMatch(/has not been independently verified by Izenzo/);
    expect(PROFILE_WORDING.demo_only).toMatch(/Demo only/);
    expect(PROFILE_WORDING.provider_pending).toMatch(/Provider pending/);
    expect(PROFILE_WORDING.api_not_ready).toBe("Not available for production API output.");
  });
});

describe("batch 26 — corrections workflow", () => {
  it("routes sensitive corrections to compliance_owner", () => {
    for (const f of SENSITIVE_CORRECTION_FIELDS) {
      expect(correctionReviewerRoleFor(f)).toBe("compliance_owner");
    }
    expect(correctionReviewerRoleFor("trading_name")).toBe("data_governance_owner");
  });
  it("never auto-publishes corrections, uses versioned history, keeps old values admin-only", () => {
    expect(CORRECTION_NEVER_AUTO_PUBLISHES).toBe(true);
    expect(CORRECTION_USES_VERSIONED_HISTORY).toBe(true);
    expect(CORRECTION_OLD_VALUES_ADMIN_ONLY_BY_DEFAULT).toBe(true);
  });
  it("blocks public exposure while a field is disputed_under_review", () => {
    expect(correctionBlocksPublicWhileDisputed("disputed_under_review")).toBe(true);
    expect(correctionBlocksPublicWhileDisputed("approved")).toBe(false);
  });
});

describe("batch 26 — audit events", () => {
  it("registers every required audit event name", () => {
    for (const e of [
      "registry_officer_public_search_blocked",
      "registry_email_phone_public_search_blocked",
      "registry_typeahead_unsafe_match_reason_suppressed",
      "registry_no_result_request_submitted",
      "registry_no_result_request_queued_admin_only",
      "registry_correction_submitted",
      "registry_correction_review_decision",
      "registry_correction_version_history_appended",
      "registry_correction_marked_disputed_under_review",
    ]) {
      expect(REGISTRY_SEARCH_PROFILE_AUDIT_EVENTS).toContain(e as any);
    }
  });
});
