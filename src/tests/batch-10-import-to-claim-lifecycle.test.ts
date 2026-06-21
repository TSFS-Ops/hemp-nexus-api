/**
 * Batch 10 — Import-to-Claim Lifecycle invariants.
 * Pure SSOT tests; no DB / network dependencies.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_RECORD_LIFECYCLE_STATES,
  REGISTRY_CLAIM_ACTIVATION_STATES,
  REGISTRY_CLAIM_AVAILABILITY_RESULTS,
  REGISTRY_CLAIM_PUBLIC_REASONS,
  REGISTRY_PUBLIC_LIFECYCLE_LABELS,
  REGISTRY_LIFECYCLE_APPROVAL_ROLES,
  REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES,
  REGISTRY_IDENTITY_FIELDS,
  REGISTRY_STALE_DEFAULTS_DAYS,
  REGISTRY_INTERNAL_ONLY_LIFECYCLE_STATES,
  REGISTRY_BATCH10_FORBIDDEN_WORDING,
  isAllowedLifecycleTransition,
  publicLifecycleLabel,
  evaluateClaimAvailability,
  type ClaimAvailabilityInputs,
} from "@/lib/registry-record-lifecycle";

const baseGoodInputs: ClaimAvailabilityInputs = {
  lifecycle_state: "claim_enabled",
  has_provenance: true,
  source_approved: true,
  business_decision_approved: true,
  country_ready: true,
  has_unresolved_high_duplicate: false,
  is_quarantined: false,
  has_active_correction_on_identity: false,
  has_claim_conflict_lock: false,
  is_stale: false,
};

describe("Batch 10 — lifecycle SSOT", () => {
  it("includes all required lifecycle states", () => {
    for (const s of [
      "imported_unverified", "import_review_required", "import_review_in_progress",
      "claim_not_available", "claim_pending_business_decision", "claim_enabled",
      "claim_suspended", "claim_conflict_locked", "correction_under_review",
      "source_refresh_required", "stale_review_required", "disabled", "archived",
    ]) {
      expect(REGISTRY_RECORD_LIFECYCLE_STATES).toContain(s);
    }
  });

  it("imported_unverified is the documented default", () => {
    expect(REGISTRY_RECORD_LIFECYCLE_STATES[0]).toBe("imported_unverified");
  });

  it("only platform_admin and compliance_owner can approve lifecycle", () => {
    expect(REGISTRY_LIFECYCLE_APPROVAL_ROLES).toEqual(["platform_admin", "compliance_owner"]);
  });

  it("all 15 lifecycle audit events declared", () => {
    expect(REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES).toHaveLength(15);
  });

  it("identity fields cover company name/registration/country/legal_form/etc", () => {
    for (const f of ["company_name", "registration_number", "country_code", "legal_form", "registered_address"]) {
      expect(REGISTRY_IDENTITY_FIELDS).toContain(f);
    }
  });

  it("stale defaults: 180 / 90 / 30", () => {
    expect(REGISTRY_STALE_DEFAULTS_DAYS.imported_unverified).toBe(180);
    expect(REGISTRY_STALE_DEFAULTS_DAYS.with_active_claim).toBe(90);
    expect(REGISTRY_STALE_DEFAULTS_DAYS.with_dispute_or_correction).toBe(30);
  });

  it("every availability result has a safe public reason", () => {
    for (const r of REGISTRY_CLAIM_AVAILABILITY_RESULTS) {
      expect(typeof REGISTRY_CLAIM_PUBLIC_REASONS[r]).toBe("string");
    }
  });
});

describe("Batch 10 — transition matrix", () => {
  it("imported_unverified → claim_enabled is allowed", () => {
    expect(isAllowedLifecycleTransition("imported_unverified", "claim_enabled")).toBe(true);
  });
  it("claim_enabled → verified is NOT a state at all", () => {
    expect(REGISTRY_RECORD_LIFECYCLE_STATES.includes("verified" as any)).toBe(false);
  });
  it("disabled → claim_enabled is blocked", () => {
    expect(isAllowedLifecycleTransition("disabled", "claim_enabled")).toBe(false);
  });
  it("archived is terminal except via admin restore — no direct claim_enabled", () => {
    expect(isAllowedLifecycleTransition("archived", "claim_enabled")).toBe(false);
  });
  it("any active state may transition to correction_under_review", () => {
    expect(isAllowedLifecycleTransition("claim_enabled", "correction_under_review")).toBe(true);
    expect(isAllowedLifecycleTransition("imported_unverified", "correction_under_review")).toBe(true);
  });
  it("correction_under_review may return to a prior active state", () => {
    expect(isAllowedLifecycleTransition("correction_under_review", "claim_enabled")).toBe(true);
  });
});

describe("Batch 10 — claim availability engine", () => {
  it("happy path: available", () => {
    expect(evaluateClaimAvailability(baseGoodInputs).result).toBe("available");
  });
  it("missing provenance → insufficient_provenance", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, has_provenance: false }).result).toBe("insufficient_provenance");
  });
  it("no business decision → business_decision_required", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, business_decision_approved: false }).result).toBe("business_decision_required");
  });
  it("country not ready → country_not_ready", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, country_ready: false }).result).toBe("country_not_ready");
  });
  it("unresolved high duplicate → duplicate_review_required", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, has_unresolved_high_duplicate: true }).result).toBe("duplicate_review_required");
  });
  it("quarantined → duplicate_review_required (review path)", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, is_quarantined: true }).result).toBe("duplicate_review_required");
  });
  it("disabled → record_disabled", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, lifecycle_state: "disabled" }).result).toBe("record_disabled");
  });
  it("archived → record_archived", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, lifecycle_state: "archived" }).result).toBe("record_archived");
  });
  it("stale (no override) → record_stale", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, is_stale: true }).result).toBe("record_stale");
  });
  it("stale with admin override → available", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, is_stale: true, admin_stale_override: true }).result).toBe("available");
  });
  it("correction on identity → correction_under_review", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, has_active_correction_on_identity: true }).result).toBe("correction_under_review");
  });
  it("claim conflict lock → claim_conflict_locked", () => {
    expect(evaluateClaimAvailability({ ...baseGoodInputs, has_claim_conflict_lock: true }).result).toBe("claim_conflict_locked");
  });
});

describe("Batch 10 — public-facing safety", () => {
  it("internal-only lifecycle states are not surfaced as labels directly", () => {
    for (const s of REGISTRY_INTERNAL_ONLY_LIFECYCLE_STATES) {
      const label = publicLifecycleLabel(s, false);
      expect(REGISTRY_PUBLIC_LIFECYCLE_LABELS).toContain(label as any);
      expect(label).not.toBe(s);
    }
  });
  it("public reasons never include forbidden verification wording", () => {
    for (const reason of Object.values(REGISTRY_CLAIM_PUBLIC_REASONS)) {
      for (const bad of REGISTRY_BATCH10_FORBIDDEN_WORDING) {
        expect(reason.toLowerCase()).not.toContain(bad.toLowerCase());
      }
    }
  });
  it("public labels never imply verification / production-ready", () => {
    for (const label of REGISTRY_PUBLIC_LIFECYCLE_LABELS) {
      for (const bad of REGISTRY_BATCH10_FORBIDDEN_WORDING) {
        expect(label.toLowerCase()).not.toContain(bad.toLowerCase());
      }
    }
  });
  it("claim_enabled label is 'Claim available' — not verified wording", () => {
    expect(publicLifecycleLabel("claim_enabled", false)).toBe("Claim available");
  });
  it("claim activation states never include 'verified' or 'production_ready'", () => {
    for (const s of REGISTRY_CLAIM_ACTIVATION_STATES) {
      expect(s).not.toMatch(/verified|production/i);
    }
  });
});
