/**
 * C8 — Client-facing wording and status honesty (safe subset) guard.
 *
 * Pins the 10 frontend-only changes:
 *   1-5. ComplianceEngine.tsx — five copy changes (Verified→KYB reviewed,
 *        drop "Within seconds, ", Continuous→Periodic, two "verified
 *        counterparty" → "reviewed counterparty").
 *   6-10. Registry surfaces — raw enum/status fields routed through the
 *         new SSOT display maps (CompanyProfile, ClaimStatus,
 *         MyCompanyEvidence, ClaimsList, Search).
 *
 * Also pins:
 *   - Deferred verifier wording is NOT touched (AuditLedger, HeroStripeGlow).
 *   - Unknown status values render through humanizeStatus, never as raw
 *     snake_case.
 *   - No backend/API/schema/migration change has been introduced in this
 *     batch (no edge-function or migration files appear in the file list
 *     that defines this batch).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatClaimWorkflowStatus,
  formatEvidenceState,
  formatReadinessLabel,
  formatClaimStatus,
  formatAuthorityStatus,
  formatProfileVerificationStatus,
  humanizeStatus,
} from "@/lib/registry-status-labels";

function read(p: string): string {
  return readFileSync(resolve(p), "utf8");
}

describe("C8 ComplianceEngine wording — safe copy changes", () => {
  const src = read("src/pages/products/ComplianceEngine.tsx");

  it("uses 'KYB reviewed' instead of unqualified 'Verified' in IdentityMockup", () => {
    expect(src).toContain(">KYB reviewed<");
    expect(src).not.toMatch(/>Verified</);
  });

  it("does not contain 'Within seconds, '", () => {
    expect(src).not.toContain("Within seconds, ");
  });

  it("hero tagline uses 'Periodic screening' not 'Continuous screening'", () => {
    expect(src).toContain("Periodic screening");
    expect(src).not.toMatch(/·\s*Continuous screening/);
  });

  it("counterparty headlines say 'reviewed' not 'verified'", () => {
    expect(src).not.toMatch(/verified counterparty/);
    expect(src).toContain("Three primitives. One reviewed counterparty.");
    expect(src).toContain("One reviewed counterparty record");
  });
});

describe("C8 registry surfaces — no raw enum status leakage", () => {
  it("CompanyProfile renders all four inspected fields through formatters", () => {
    const src = read("src/pages/registry/CompanyProfile.tsx");
    expect(src).toContain("formatReadinessLabel(profile.readiness_label)");
    expect(src).toContain("formatClaimStatus(profile.claim_status)");
    expect(src).toContain("formatAuthorityStatus(profile.authority_status)");
    expect(src).toContain(
      "formatProfileVerificationStatus(profile.profile_verification_status)",
    );
    // No raw enum interpolation in Badges
    expect(src).not.toMatch(/\{profile\.readiness_label\}<\/Badge>/);
    expect(src).not.toMatch(/\{profile\.claim_status\}<\/Badge>/);
    expect(src).not.toMatch(/\{profile\.authority_status\}<\/Badge>/);
    expect(src).not.toMatch(/\{profile\.profile_verification_status\}<\/Badge>/);
  });

  it("ClaimStatus uses display formatters for workflow + evidence state", () => {
    const src = read("src/pages/registry/ClaimStatus.tsx");
    expect(src).toContain("formatClaimWorkflowStatus(c.workflow_status)");
    expect(src).toContain("formatEvidenceState(e.evidence_state)");
    expect(src).not.toMatch(/\{c\.workflow_status\}<\/Badge>/);
    expect(src).not.toMatch(/\{e\.evidence_state\}<\/Badge>/);
  });

  it("ClaimsList uses formatter for workflow_status", () => {
    const src = read("src/pages/registry/ClaimsList.tsx");
    expect(src).toContain("formatClaimWorkflowStatus(r.workflow_status)");
    expect(src).not.toMatch(/\{r\.workflow_status\}<\/Badge>/);
  });

  it("MyCompanyEvidence uses formatter for evidence_state", () => {
    const src = read("src/pages/registry/MyCompanyEvidence.tsx");
    expect(src).toContain("formatEvidenceState(e.evidence_state)");
    expect(src).not.toContain('{e.evidence_state ?? "submitted"}');
  });

  it("Search uses <ReadinessBadge> for the readiness label", () => {
    const src = read("src/pages/registry/Search.tsx");
    expect(src).toContain("<ReadinessBadge state={r.readiness_label} />");
    expect(src).not.toMatch(
      /<Badge variant="secondary"[^>]*>\{r\.readiness_label\}<\/Badge>/,
    );
  });
});

describe("C8 status formatters — safe fallbacks, no raw snake_case", () => {
  it("humanizeStatus title-cases unknown values without snake_case", () => {
    expect(humanizeStatus("some_unknown_value")).toBe("Some Unknown Value");
    expect(humanizeStatus("")).toBe("Status pending");
    expect(humanizeStatus(null)).toBe("Status pending");
    expect(humanizeStatus(undefined)).toBe("Status pending");
  });

  it("claim workflow formatter weakens 'approved' to 'Claim reviewed'", () => {
    expect(formatClaimWorkflowStatus("approved")).toBe("Claim reviewed");
    expect(formatClaimWorkflowStatus("rejected")).toBe("Not approved");
    expect(formatClaimWorkflowStatus("under_review")).toBe("Under review");
    expect(formatClaimWorkflowStatus("totally_new_state")).not.toMatch(/_/);
    expect(formatClaimWorkflowStatus(null)).toBe("Status pending");
  });

  it("evidence formatter weakens 'accepted'/'approved' to plain wording", () => {
    expect(formatEvidenceState("accepted")).toBe("Accepted");
    expect(formatEvidenceState("approved")).toBe("Accepted");
    expect(formatEvidenceState("rejected")).toBe("Not accepted");
    expect(formatEvidenceState("brand_new_state")).not.toMatch(/_/);
    expect(formatEvidenceState(null)).toBe("Submitted");
  });

  it("readiness formatter hedges 'imported_unverified'", () => {
    expect(formatReadinessLabel("imported_unverified")).toBe(
      "Imported, not independently confirmed",
    );
    expect(formatReadinessLabel("xyz_unknown_state")).not.toMatch(/_/);
    expect(formatReadinessLabel(null)).toBe("Status pending");
  });

  it("claim status / authority / profile-verification formatters never expose raw enums", () => {
    expect(formatClaimStatus("unclaimed")).toBe("Unclaimed");
    expect(formatClaimStatus("zz_unknown")).not.toMatch(/_/);
    expect(formatAuthorityStatus("authority_pending")).toBe("Authority pending");
    expect(formatAuthorityStatus("zz_unknown")).not.toMatch(/_/);
    expect(formatProfileVerificationStatus("profile_not_verified")).toBe(
      "Profile not independently reviewed",
    );
    expect(formatProfileVerificationStatus("zz_unknown")).not.toMatch(/_/);
  });

  it("none of the formatter labels claim 'verified' on non-production surfaces", () => {
    // Defensive: claim/evidence/profile labels must not assert verification.
    const labels = [
      formatClaimWorkflowStatus("approved"),
      formatClaimStatus("approved"),
      formatClaimStatus("one_claim_approved"),
      formatEvidenceState("accepted"),
      formatEvidenceState("approved"),
      formatProfileVerificationStatus("profile_verified"),
      formatProfileVerificationStatus("profile_not_verified"),
    ];
    for (const l of labels) expect(l.toLowerCase()).not.toMatch(/\bverified\b/);
  });
});

describe("C8 deferred verifier wording — left untouched", () => {
  it("AuditLedger.tsx still contains the deferred phrases (client decision pending)", () => {
    const src = read("src/pages/products/AuditLedger.tsx");
    expect(src).toContain("Start verifying mathematics.");
    expect(src).toContain("re-verifiable deal records");
  });

  it("HeroStripeGlow.tsx still contains 'independently verifiable execution'", () => {
    const src = read("src/components/landing/HeroStripeGlow.tsx");
    expect(src).toContain("independently verifiable execution");
  });
});
