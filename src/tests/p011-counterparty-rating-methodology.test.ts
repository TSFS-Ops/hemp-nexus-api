/**
 * P011 — Counterparty Rating Methodology Visibility.
 * Internal acceptance tests covering the 5 client examples, role visibility
 * matrix, audit-name pinning, override invariants, and forbidden-wording rules.
 */
import { describe, it, expect } from "vitest";
import {
  COUNTERPARTY_RATING_METHODOLOGY_VERSION,
  EVIDENCE_RATING_AUDIT_NAMES,
  EVIDENCE_RATING_BAND_LABELS,
  EVIDENCE_RATING_BAND_USER_MEANING,
  EVIDENCE_RATING_DISCLAIMER,
  EVIDENCE_RATING_FORBIDDEN_WORDS,
  EVIDENCE_RATING_FRESHNESS_DAYS,
  EVIDENCE_RATING_NON_LIVE_PROVIDERS,
  EVIDENCE_RATING_OVERRIDE_MAX_DAYS_DEFAULT,
  EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH,
  EVIDENCE_RATING_OVERRIDE_REASONS,
  computeEvidenceRating,
  containsForbiddenRatingWord,
  type EvidenceRatingInputs,
} from "@/lib/evidence-rating";

const NOW = new Date("2026-06-20T12:00:00Z");
const FRESH = new Date(NOW.getTime() - 1_000).toISOString();
const STALE_PUBLIC = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
const STALE_SANCTIONS = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();

const baseInputs = (): EvidenceRatingInputs => ({
  public_source_signals: [],
  kyb_registry: null,
  sanctions_pep: null,
  ubo_authority: null,
  documents: [],
  admin_review_active: false,
  active_negative_signal: false,
  has_admin_override: false,
  now: NOW,
});

describe("P011 — pins and constants", () => {
  it("methodology version is 1.0", () => {
    expect(COUNTERPARTY_RATING_METHODOLOGY_VERSION).toBe("1.0");
  });

  it("exposes exactly 5 rating bands", () => {
    expect(Object.keys(EVIDENCE_RATING_BAND_LABELS).sort()).toEqual(
      [
        "admin_reviewed",
        "flagged",
        "limited_information",
        "public_source_supported",
        "verification_complete",
      ].sort(),
    );
  });

  it("exposes 12 canonical audit names", () => {
    expect(EVIDENCE_RATING_AUDIT_NAMES.length).toBe(12);
    expect(EVIDENCE_RATING_AUDIT_NAMES).toContain("counterparty_rating.rating_calculated");
    expect(EVIDENCE_RATING_AUDIT_NAMES).toContain("counterparty_rating.rating_override_applied");
    expect(EVIDENCE_RATING_AUDIT_NAMES).toContain("counterparty_rating.rating_recalculation_failed");
    expect(EVIDENCE_RATING_AUDIT_NAMES).toContain("counterparty_rating.methodology_version_changed");
  });

  it("exposes 8 approved override reasons", () => {
    expect(EVIDENCE_RATING_OVERRIDE_REASONS.length).toBe(8);
  });

  it("freshness windows match the methodology", () => {
    expect(EVIDENCE_RATING_FRESHNESS_DAYS.public_source).toBe(30);
    expect(EVIDENCE_RATING_FRESHNESS_DAYS.sanctions_pep).toBe(7);
    expect(EVIDENCE_RATING_FRESHNESS_DAYS.kyb_registry).toBe(365);
    expect(EVIDENCE_RATING_FRESHNESS_DAYS.admin_review).toBe(90);
  });

  it("override expiry default is 90 days; min reason length is 30", () => {
    expect(EVIDENCE_RATING_OVERRIDE_MAX_DAYS_DEFAULT).toBe(90);
    expect(EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH).toBe(30);
  });

  it("non-live provider list contains the four P010 stubs", () => {
    expect([...EVIDENCE_RATING_NON_LIVE_PROVIDERS].sort()).toEqual(
      ["cipc", "dow_jones", "onfido", "refinitiv"].sort(),
    );
  });
});

describe("P011 — forbidden wording", () => {
  it("forbidden words never appear in band labels or user meanings", () => {
    for (const band of Object.values(EVIDENCE_RATING_BAND_LABELS)) {
      expect(containsForbiddenRatingWord(band)).toBeNull();
    }
    for (const meaning of Object.values(EVIDENCE_RATING_BAND_USER_MEANING)) {
      expect(containsForbiddenRatingWord(meaning)).toBeNull();
    }
  });

  it("disclaimer wording is verbatim and avoids approval/clearance framing in the headline noun", () => {
    expect(EVIDENCE_RATING_DISCLAIMER).toContain(
      "This counterparty rating is an informational signal",
    );
    expect(EVIDENCE_RATING_DISCLAIMER).toContain("not a guarantee");
    expect(EVIDENCE_RATING_DISCLAIMER).toContain("Formal Izenzo workflow gates still apply.");
  });

  it("forbidden-word list contains all 9 entries", () => {
    expect(EVIDENCE_RATING_FORBIDDEN_WORDS.length).toBe(9);
  });
});

describe("P011 — client examples", () => {
  it("Example 1 — TEST Alpha Imports → Limited Information", () => {
    const r = computeEvidenceRating(baseInputs());
    expect(r.band).toBe("limited_information");
    expect(r.workflow_effect.blocks_wad_progression).toBe(false);
    expect(r.missing_inputs.length).toBeGreaterThan(0);
  });

  it("Example 2 — TEST Beta Commodities → Public-Source Supported", () => {
    const i = baseInputs();
    i.public_source_signals = [
      { key: "registry", label: "Registry", status: "completed", completed_at: FRESH, matched_identifier: "reg_123" },
      { key: "jurisdiction", label: "Jurisdiction", status: "completed", completed_at: FRESH, matched_identifier: "ZA" },
    ];
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("public_source_supported");
  });

  it("Example 3 — TEST Gamma Exporters → Admin-Reviewed", () => {
    const i = baseInputs();
    i.public_source_signals = [
      { key: "registry", label: "Registry", status: "completed", completed_at: FRESH, matched_identifier: "reg" },
      { key: "address", label: "Address", status: "completed", completed_at: FRESH, matched_identifier: "addr" },
    ];
    i.documents = [{ key: "doc", label: "Doc", status: "completed", completed_at: FRESH }];
    i.admin_review_active = true;
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("admin_reviewed");
  });

  it("Example 4 — TEST Delta Energy → Verification Complete", () => {
    const i = baseInputs();
    i.public_source_signals = [
      { key: "registry", label: "Registry", status: "completed", completed_at: FRESH, matched_identifier: "reg" },
      { key: "address", label: "Address", status: "completed", completed_at: FRESH, matched_identifier: "addr" },
    ];
    i.kyb_registry = { key: "kyb", label: "KYB", status: "completed", provider: "live_kyb_v1", is_live_provider: true, completed_at: FRESH };
    i.sanctions_pep = { key: "sanc", label: "Sanctions", status: "completed", provider: "dilisense", is_live_provider: true, completed_at: FRESH };
    i.ubo_authority = { key: "ubo", label: "UBO", status: "completed", provider: "ubo_live", is_live_provider: true, completed_at: FRESH };
    i.documents = [{ key: "doc", label: "Doc", status: "completed", completed_at: FRESH }];
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("verification_complete");
    expect(r.supporting_factors.length).toBeGreaterThan(0);
    expect(r.supporting_factors.length).toBeLessThanOrEqual(3);
  });

  it("Example 5 — TEST Echo Trading → Flagged", () => {
    const i = baseInputs();
    i.active_negative_signal = true;
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("flagged");
    expect(r.workflow_effect.blocks_wad_progression).toBe(true);
    expect(r.workflow_effect.requires_admin_review).toBe(true);
  });
});

describe("P011 — guarded rules", () => {
  it("stub providers (CIPC/Onfido/Dow Jones/Refinitiv) cannot support Verification Complete", () => {
    for (const provider of EVIDENCE_RATING_NON_LIVE_PROVIDERS) {
      const i = baseInputs();
      i.public_source_signals = [
        { key: "a", label: "a", status: "completed", completed_at: FRESH, matched_identifier: "x" },
        { key: "b", label: "b", status: "completed", completed_at: FRESH, matched_identifier: "y" },
      ];
      i.kyb_registry = { key: "kyb", label: "KYB", status: "completed", provider, is_live_provider: true, completed_at: FRESH };
      i.sanctions_pep = { key: "s", label: "S", status: "completed", provider, is_live_provider: true, completed_at: FRESH };
      i.ubo_authority = { key: "u", label: "U", status: "completed", provider, is_live_provider: true, completed_at: FRESH };
      i.documents = [{ key: "d", label: "D", status: "completed", completed_at: FRESH }];
      const r = computeEvidenceRating(i);
      expect(r.band).not.toBe("verification_complete");
    }
  });

  it("stale sanctions check cannot support Verification Complete", () => {
    const i = baseInputs();
    i.public_source_signals = [
      { key: "a", label: "a", status: "completed", completed_at: FRESH, matched_identifier: "x" },
      { key: "b", label: "b", status: "completed", completed_at: FRESH, matched_identifier: "y" },
    ];
    i.kyb_registry = { key: "kyb", label: "KYB", status: "completed", provider: "live", is_live_provider: true, completed_at: FRESH };
    i.sanctions_pep = { key: "s", label: "S", status: "completed", provider: "live", is_live_provider: true, completed_at: STALE_SANCTIONS };
    i.ubo_authority = { key: "u", label: "U", status: "completed", provider: "live", is_live_provider: true, completed_at: FRESH };
    i.documents = [{ key: "d", label: "D", status: "completed", completed_at: FRESH }];
    const r = computeEvidenceRating(i);
    expect(r.band).not.toBe("verification_complete");
  });

  it("public-source band needs ≥2 fresh signals + ≥1 matched identifier", () => {
    const single = baseInputs();
    single.public_source_signals = [
      { key: "a", label: "a", status: "completed", completed_at: FRESH, matched_identifier: "x" },
    ];
    expect(computeEvidenceRating(single).band).toBe("limited_information");

    const twoNoIdent = baseInputs();
    twoNoIdent.public_source_signals = [
      { key: "a", label: "a", status: "completed", completed_at: FRESH },
      { key: "b", label: "b", status: "completed", completed_at: FRESH },
    ];
    expect(computeEvidenceRating(twoNoIdent).band).toBe("limited_information");
  });

  it("stale public-source signals do not count and appear in stale_inputs", () => {
    const i = baseInputs();
    i.public_source_signals = [
      { key: "a", label: "a", status: "completed", completed_at: STALE_PUBLIC, matched_identifier: "x" },
      { key: "b", label: "b", status: "completed", completed_at: STALE_PUBLIC, matched_identifier: "y" },
    ];
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("limited_information");
    expect(r.stale_inputs.length).toBe(2);
  });

  it("active negative signal forces flagged even with full live coverage", () => {
    const i = baseInputs();
    i.active_negative_signal = true;
    i.kyb_registry = { key: "kyb", label: "KYB", status: "completed", provider: "live", is_live_provider: true, completed_at: FRESH };
    i.sanctions_pep = { key: "s", label: "S", status: "completed", provider: "live", is_live_provider: true, completed_at: FRESH };
    i.ubo_authority = { key: "u", label: "U", status: "completed", provider: "live", is_live_provider: true, completed_at: FRESH };
    i.documents = [{ key: "d", label: "D", status: "completed", completed_at: FRESH }];
    const r = computeEvidenceRating(i);
    expect(r.band).toBe("flagged");
  });

  it("missing data defaults to limited_information (never positive)", () => {
    const r = computeEvidenceRating(baseInputs());
    expect(r.band).toBe("limited_information");
    expect(r.missing_inputs).toContain("at_least_two_approved_public_source_signals");
  });
});
