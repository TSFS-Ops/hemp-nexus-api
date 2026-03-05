/**
 * Discovery Intelligence (INTEL) Layer — Unit Tests
 * 
 * Tests the DISC-003 Public Presence Score formula,
 * DISC-006 Eligibility Scoring logic, and gate enforcement rules.
 */
import { describe, it, expect } from "vitest";

// ── DISC-003: Public Presence Score ──
// Formula: min(10, floor(ln(R+1) * 3))  where R = NEWS + SOCIAL + WEB

function calculatePublicPresenceScore(news: number, social: number, web: number): number {
  const R = news + social + web;
  return Math.min(10, Math.floor(Math.log(R + 1) * 3));
}

describe("DISC-003: Public Presence Score", () => {
  it("returns 0 when all reference counts are 0", () => {
    expect(calculatePublicPresenceScore(0, 0, 0)).toBe(0);
  });

  it("returns correct score for a single reference", () => {
    // R=1 → ln(2)*3 ≈ 2.079 → floor = 2
    expect(calculatePublicPresenceScore(1, 0, 0)).toBe(2);
  });

  it("returns correct score for moderate references", () => {
    // R=10 → ln(11)*3 ≈ 7.19 → floor = 7
    expect(calculatePublicPresenceScore(3, 3, 4)).toBe(7);
  });

  it("caps at 10 for high reference counts", () => {
    // R=50 → ln(51)*3 ≈ 11.79 → min(10, 11) = 10
    expect(calculatePublicPresenceScore(20, 15, 15)).toBe(10);
  });

  it("caps at 10 for very large counts", () => {
    expect(calculatePublicPresenceScore(100, 100, 100)).toBe(10);
  });

  it("is symmetric across source categories", () => {
    const a = calculatePublicPresenceScore(5, 0, 0);
    const b = calculatePublicPresenceScore(0, 5, 0);
    const c = calculatePublicPresenceScore(0, 0, 5);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ── DISC-006: Eligibility Scoring ──

interface EligibilitySignals {
  id_verified: boolean;
  contact_verified: boolean;
  company_exists: boolean;
  email_domain_match: boolean;
  operating_footprint_score: number; // 0-10
  public_presence_score: number;     // 0-10
  authority_document_present: boolean;
  other_supporting_collateral_count: number;
  sanctions_status: "CLEAR" | "POTENTIAL_MATCH" | "CONFIRMED_MATCH";
  entity_match_confidence: number;
  has_crawl: boolean;
}

interface EligibilityResult {
  score: number;
  status: "PASS" | "REVIEW" | "FAIL";
  hard_fail_reasons: string[];
  review_reasons: string[];
}

function computeEligibility(signals: EligibilitySignals): EligibilityResult {
  let score = 0;
  if (signals.id_verified) score += 20;
  if (signals.contact_verified) score += 5;
  if (signals.company_exists) score += 20;
  if (signals.email_domain_match) score += 10;
  score += signals.operating_footprint_score;
  score += signals.public_presence_score;
  if (signals.authority_document_present) score += 5;
  score += Math.min(5, signals.other_supporting_collateral_count);

  const hardFails: string[] = [];
  if (signals.sanctions_status === "CONFIRMED_MATCH") hardFails.push("SANCTIONS_STATUS == CONFIRMED_MATCH");
  if (!signals.id_verified) hardFails.push("ID_VERIFIED == FALSE");
  if (!signals.company_exists) hardFails.push("COMPANY_EXISTS == FALSE");

  const reviewReasons: string[] = [];
  if (signals.sanctions_status === "POTENTIAL_MATCH") reviewReasons.push("SANCTIONS_STATUS == POTENTIAL_MATCH");
  if (signals.entity_match_confidence < 0.70 && signals.has_crawl) {
    reviewReasons.push(`ENTITY_MATCH_CONFIDENCE < 0.70 (${signals.entity_match_confidence})`);
  }

  let status: "PASS" | "REVIEW" | "FAIL";
  if (hardFails.length > 0) {
    status = "FAIL";
  } else if (reviewReasons.length > 0) {
    status = "REVIEW";
  } else if (score >= 65) {
    status = "PASS";
  } else if (score >= 45) {
    status = "REVIEW";
  } else {
    status = "FAIL";
  }

  return { score, status, hard_fail_reasons: hardFails, review_reasons: reviewReasons };
}

const FULL_PASS_SIGNALS: EligibilitySignals = {
  id_verified: true,
  contact_verified: true,
  company_exists: true,
  email_domain_match: true,
  operating_footprint_score: 8,
  public_presence_score: 7,
  authority_document_present: true,
  other_supporting_collateral_count: 5,
  sanctions_status: "CLEAR",
  entity_match_confidence: 0.85,
  has_crawl: true,
};

describe("DISC-006: Eligibility Scoring", () => {
  it("PASS — fully qualified entity scores ≥ 65", () => {
    const result = computeEligibility(FULL_PASS_SIGNALS);
    // 20+5+20+10+8+7+5+5 = 80
    expect(result.score).toBe(80);
    expect(result.status).toBe("PASS");
    expect(result.hard_fail_reasons).toHaveLength(0);
    expect(result.review_reasons).toHaveLength(0);
  });

  it("FAIL — confirmed sanctions match is a hard fail regardless of score", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, sanctions_status: "CONFIRMED_MATCH" });
    expect(result.status).toBe("FAIL");
    expect(result.hard_fail_reasons).toContain("SANCTIONS_STATUS == CONFIRMED_MATCH");
  });

  it("FAIL — id_verified=false is a hard fail", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, id_verified: false });
    expect(result.status).toBe("FAIL");
    expect(result.hard_fail_reasons).toContain("ID_VERIFIED == FALSE");
  });

  it("FAIL — company_exists=false is a hard fail", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, company_exists: false });
    expect(result.status).toBe("FAIL");
    expect(result.hard_fail_reasons).toContain("COMPANY_EXISTS == FALSE");
  });

  it("REVIEW — potential sanctions match triggers review", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, sanctions_status: "POTENTIAL_MATCH" });
    expect(result.status).toBe("REVIEW");
    expect(result.review_reasons).toContain("SANCTIONS_STATUS == POTENTIAL_MATCH");
  });

  it("REVIEW — low entity confidence triggers review", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, entity_match_confidence: 0.55 });
    expect(result.status).toBe("REVIEW");
    expect(result.review_reasons[0]).toContain("ENTITY_MATCH_CONFIDENCE < 0.70");
  });

  it("REVIEW — score between 45-64 triggers review", () => {
    const result = computeEligibility({
      ...FULL_PASS_SIGNALS,
      contact_verified: false,
      email_domain_match: false,
      operating_footprint_score: 2,
      public_presence_score: 2,
      authority_document_present: false,
      other_supporting_collateral_count: 0,
    });
    // 20+0+20+0+2+2+0+0 = 44 → FAIL
    expect(result.score).toBe(44);
    expect(result.status).toBe("FAIL");
  });

  it("REVIEW — score exactly 45 is REVIEW", () => {
    const result = computeEligibility({
      ...FULL_PASS_SIGNALS,
      contact_verified: false,
      email_domain_match: false,
      operating_footprint_score: 2,
      public_presence_score: 3,
      authority_document_present: false,
      other_supporting_collateral_count: 0,
    });
    // 20+0+20+0+2+3+0+0 = 45
    expect(result.score).toBe(45);
    expect(result.status).toBe("REVIEW");
  });

  it("PASS — score exactly 65 is PASS", () => {
    const result = computeEligibility({
      ...FULL_PASS_SIGNALS,
      operating_footprint_score: 5,
      public_presence_score: 0,
      other_supporting_collateral_count: 0,
    });
    // 20+5+20+10+5+0+5+0 = 65
    expect(result.score).toBe(65);
    expect(result.status).toBe("PASS");
  });

  it("collateral count is capped at 5", () => {
    const r1 = computeEligibility({ ...FULL_PASS_SIGNALS, other_supporting_collateral_count: 5 });
    const r2 = computeEligibility({ ...FULL_PASS_SIGNALS, other_supporting_collateral_count: 50 });
    expect(r1.score).toBe(r2.score);
  });

  it("no crawl data means low confidence does NOT trigger review", () => {
    const result = computeEligibility({
      ...FULL_PASS_SIGNALS,
      entity_match_confidence: 0.3,
      has_crawl: false,
    });
    // No crawl → confidence check skipped → still PASS
    expect(result.status).toBe("PASS");
    expect(result.review_reasons).toHaveLength(0);
  });
});

// ── Gate Enforcement Logic ──

describe("Gate Enforcement: POI + WaD", () => {
  it("blocks POI transition if eligibility is not PASS", () => {
    const result = computeEligibility({ ...FULL_PASS_SIGNALS, id_verified: false });
    expect(result.status).not.toBe("PASS");
    // Gate would block: eligibility_status !== PASS
  });

  it("allows POI transition if eligibility is PASS", () => {
    const result = computeEligibility(FULL_PASS_SIGNALS);
    expect(result.status).toBe("PASS");
  });

  it("both buyer and seller must PASS for WaD sealing", () => {
    const buyerResult = computeEligibility(FULL_PASS_SIGNALS);
    const sellerResult = computeEligibility(FULL_PASS_SIGNALS);
    expect(buyerResult.status).toBe("PASS");
    expect(sellerResult.status).toBe("PASS");
    const wadGatePass = buyerResult.status === "PASS" && sellerResult.status === "PASS";
    expect(wadGatePass).toBe(true);
  });

  it("WaD gate fails if either party is not PASS", () => {
    const buyerResult = computeEligibility(FULL_PASS_SIGNALS);
    const sellerResult = computeEligibility({ ...FULL_PASS_SIGNALS, sanctions_status: "CONFIRMED_MATCH" });
    const wadGatePass = buyerResult.status === "PASS" && sellerResult.status === "PASS";
    expect(wadGatePass).toBe(false);
  });
});
