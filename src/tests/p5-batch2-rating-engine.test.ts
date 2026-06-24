import { describe, expect, it } from "vitest";
import { rateP5B2Evidence } from "@/lib/p5-batch2/rating-engine";

describe("p5-batch2 rating-engine", () => {
  it("returns strong with full completeness, party match, no expiry", () => {
    const r = rateP5B2Evidence({
      status: "accepted",
      completeness: 1,
      expired: false,
      party_match: true,
      metadata_quality: 1,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: false,
    });
    expect(r.rating).toBe("strong");
  });

  it("flags mandatory evidence as requiring human review even when strong", () => {
    const r = rateP5B2Evidence({
      status: "uploaded",
      completeness: 1,
      expired: false,
      party_match: true,
      metadata_quality: 1,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: true,
    });
    expect(r.human_review_required).toBe(true);
  });

  it("returns provider_dependent when provider not live regardless of completeness", () => {
    const r = rateP5B2Evidence({
      status: "provider_dependent",
      completeness: 1,
      expired: false,
      party_match: true,
      provider_dependency: true,
      provider_live: false,
      is_mandatory: true,
    });
    expect(r.rating).toBe("provider_dependent");
    expect(r.human_review_required).toBe(true);
  });

  it("returns unusable when expired", () => {
    const r = rateP5B2Evidence({
      status: "accepted",
      completeness: 1,
      expired: true,
      party_match: true,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: false,
    });
    expect(r.rating).toBe("unusable");
  });

  it("returns unusable when rejected", () => {
    const r = rateP5B2Evidence({
      status: "rejected",
      completeness: 1,
      expired: false,
      party_match: true,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: false,
    });
    expect(r.rating).toBe("unusable");
  });

  it("returns weak on party mismatch", () => {
    const r = rateP5B2Evidence({
      status: "uploaded",
      completeness: 1,
      expired: false,
      party_match: false,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: false,
    });
    expect(r.rating).toBe("weak");
    expect(r.reasons).toContain("party_mismatch");
  });

  it("returns acceptable for mid completeness", () => {
    const r = rateP5B2Evidence({
      status: "uploaded",
      completeness: 0.7,
      expired: false,
      party_match: true,
      metadata_quality: 0.8,
      provider_dependency: false,
      provider_live: false,
      is_mandatory: false,
    });
    expect(["acceptable", "good"]).toContain(r.rating);
  });
});
