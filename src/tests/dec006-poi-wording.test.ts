/**
 * DEC-006 — POI binding-wording helper and signed-constant tests.
 */
import { describe, it, expect } from "vitest";
import {
  DRAFT_POI_LABEL,
  ACCEPTED_POI_LABEL,
  POST_ACCEPTANCE_QUALIFIER,
  UNSAFE_POI_WARNING,
  getPoiLabel,
  assertPoiWordingSafe,
} from "@/lib/legal/poi-wording";
import { readFileSync } from "node:fs";

describe("DEC-006 — signed POI wording constants", () => {
  it("Draft POI label is exact", () => {
    expect(DRAFT_POI_LABEL).toBe(
      "Draft POI — initiator-generated intent record, awaiting counterparty confirmation.",
    );
  });
  it("Accepted POI label is exact", () => {
    expect(ACCEPTED_POI_LABEL).toBe("Accepted POI — mutual intent recorded.");
  });
  it("Post-acceptance qualifier is exact", () => {
    expect(POST_ACCEPTANCE_QUALIFIER).toContain("Proof of mutual intention recorded.");
    expect(POST_ACCEPTANCE_QUALIFIER).toContain("WaD, execution, and finality remain subject");
  });
});

describe("DEC-006 — getPoiLabel", () => {
  it("returns Draft label pre-acceptance", () => {
    expect(getPoiLabel({ accepted: false }).label).toBe(DRAFT_POI_LABEL);
    expect(getPoiLabel({ accepted: false }).state).toBe("draft");
  });
  it("returns Accepted label post-acceptance with qualifier on bilateral", () => {
    const r = getPoiLabel({ accepted: true, bilateral: true });
    expect(r.label).toBe(ACCEPTED_POI_LABEL);
    expect(r.qualifier).toBe(POST_ACCEPTANCE_QUALIFIER);
    expect(r.state).toBe("accepted");
  });
});

describe("DEC-006 — assertPoiWordingSafe", () => {
  it("blocks 'sealed POI' pre-acceptance", () => {
    const r = assertPoiWordingSafe("POI sealed in 1 second.", { accepted: false });
    expect(r.ok).toBe(false);
    expect(r.warning).toBe(UNSAFE_POI_WARNING);
  });
  it("allows 'accepted' once accepted=true", () => {
    expect(assertPoiWordingSafe("Accepted POI recorded.", { accepted: true }).ok).toBe(true);
  });
});

describe("DEC-006 — POI sealed toast removed from match details hook", () => {
  const src = readFileSync("src/hooks/use-match-details.ts", "utf8");
  it("does not toast 'POI sealed'", () => {
    expect(src).not.toContain("POI sealed.");
  });
  it("uses the signed Draft POI wording", () => {
    expect(src).toContain("Draft POI recorded");
  });
});

describe("DEC-006 — counterparty notification template uses Draft POI wording", () => {
  const src = readFileSync(
    "supabase/functions/_shared/transactional-email-templates/poi-counterparty-notify.tsx",
    "utf8",
  );
  it("does not say 'POI issued' in subject or body", () => {
    expect(src).not.toMatch(/POI issued/);
  });
  it("includes Draft Proof of Intent wording", () => {
    expect(src).toContain("Draft Proof of Intent");
  });
});
