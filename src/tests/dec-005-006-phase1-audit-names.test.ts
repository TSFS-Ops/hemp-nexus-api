/**
 * DEC-005 / DEC-006 Phase 1 — Canonical audit-name SSOT, signed wording
 * stability, helper purity, and prebuild wiring tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEC_005_AUDIT_ACTIONS,
  DEC_006_AUDIT_ACTIONS,
  DEC_005_006_CANONICAL_AUDIT_ACTIONS,
} from "@/lib/legal/dec-005-006-audit";
import {
  PENDING_ENGAGEMENT_LABEL,
  INITIATOR_PENDING_COPY,
  OUTREACH_INVITATION_COPY,
  UNSAFE_PRE_ACCEPTANCE_WARNING,
  assertPreAcceptanceSafe,
} from "@/lib/legal/pre-acceptance-wording";
import {
  DRAFT_POI_LABEL,
  ACCEPTED_POI_LABEL,
  POST_ACCEPTANCE_QUALIFIER,
  UNSAFE_POI_WARNING,
  assertPoiWordingSafe,
  getPoiLabel,
} from "@/lib/legal/poi-wording";

describe("DEC-005 / DEC-006 Phase 1 — canonical audit-name SSOT", () => {
  it("declares the three DEC-005 canonical audit actions verbatim", () => {
    expect(DEC_005_AUDIT_ACTIONS.pre_acceptance_wording_applied).toBe(
      "legal.pre_acceptance_wording_applied",
    );
    expect(DEC_005_AUDIT_ACTIONS.unsafe_pre_acceptance_wording_blocked).toBe(
      "legal.unsafe_pre_acceptance_wording_blocked",
    );
    expect(DEC_005_AUDIT_ACTIONS.acceptance_recorded_wording_state_updated).toBe(
      "counterparty.acceptance_recorded_wording_state_updated",
    );
  });

  it("declares the three DEC-006 canonical audit actions verbatim", () => {
    expect(DEC_006_AUDIT_ACTIONS.poi_binding_wording_applied).toBe(
      "legal.poi_binding_wording_applied",
    );
    expect(DEC_006_AUDIT_ACTIONS.unsafe_poi_binding_claim_blocked).toBe(
      "legal.unsafe_poi_binding_claim_blocked",
    );
    expect(DEC_006_AUDIT_ACTIONS.poi_wording_updated_after_counterparty_acceptance).toBe(
      "legal.poi_wording_updated_after_counterparty_acceptance",
    );
  });

  it("exposes a frozen 6-name canonical tuple", () => {
    expect(DEC_005_006_CANONICAL_AUDIT_ACTIONS).toHaveLength(6);
    expect(() => {
      // @ts-expect-error — verifying frozen at runtime
      DEC_005_006_CANONICAL_AUDIT_ACTIONS.push("legal.injected");
    }).toThrow();
  });
});

describe("DEC-005 — signed pre-acceptance wording remains verbatim", () => {
  it("Pending Engagement label", () => {
    expect(PENDING_ENGAGEMENT_LABEL).toBe(
      "Pending Engagement — counterparty invited, awaiting confirmation.",
    );
  });
  it("Initiator copy", () => {
    expect(INITIATOR_PENDING_COPY).toBe(
      "Counterparty invitation sent. This trade remains pending until the counterparty confirms participation.",
    );
  });
  it("Outreach invitation copy", () => {
    expect(OUTREACH_INVITATION_COPY).toContain(
      "You have been invited to review a proposed trade on Izenzo.",
    );
    expect(OUTREACH_INVITATION_COPY).toContain(
      "This invitation does not confirm your acceptance.",
    );
  });
  it("Unsafe-wording warning", () => {
    expect(UNSAFE_PRE_ACCEPTANCE_WARNING).toBe(
      "This wording is not approved before counterparty acceptance. Use pending, invited, awaiting counterparty confirmation, or draft wording only.",
    );
  });
});

describe("DEC-006 — signed POI wording remains verbatim", () => {
  it("Draft POI", () => {
    expect(DRAFT_POI_LABEL).toBe(
      "Draft POI — initiator-generated intent record, awaiting counterparty confirmation.",
    );
  });
  it("Accepted POI", () => {
    expect(ACCEPTED_POI_LABEL).toBe("Accepted POI — mutual intent recorded.");
  });
  it("Post-acceptance qualifier", () => {
    expect(POST_ACCEPTANCE_QUALIFIER).toContain("Proof of mutual intention recorded.");
    expect(POST_ACCEPTANCE_QUALIFIER).toContain("WaD, execution, and finality remain subject");
  });
});

describe("DEC-005 / DEC-006 — unsafe wording blocked", () => {
  it.each(["accepted", "binding", "sealed", "verified", "confirmed", "complete", "completed", "mutual", "contracted", "settled", "executed", "final"])(
    "blocks forbidden pre-acceptance term %s",
    (term) => {
      const r = assertPreAcceptanceSafe(`This trade is ${term} now.`);
      expect(r.ok).toBe(false);
      expect(r.warning).toBe(UNSAFE_PRE_ACCEPTANCE_WARNING);
    },
  );
  it.each(["binding", "sealed", "mutual", "completed", "contracted", "final"])(
    "blocks POI finality term %s when accepted=false",
    (term) => {
      const r = assertPoiWordingSafe(`POI ${term} in 1 second.`, { accepted: false });
      expect(r.ok).toBe(false);
      expect(r.warning).toBe(UNSAFE_POI_WARNING);
    },
  );
});

describe("DEC-005 / DEC-006 — wording helpers are side-effect free", () => {
  // Snapshot the global mutation surfaces we care about.
  it("assertPreAcceptanceSafe does not call fetch / console.error / throw on safe input", () => {
    const origFetch = (globalThis as any).fetch;
    let fetchCount = 0;
    (globalThis as any).fetch = (...args: unknown[]) => {
      fetchCount++;
      return origFetch?.(...args);
    };
    try {
      const r = assertPreAcceptanceSafe("pending counterparty confirmation");
      expect(r.ok).toBe(true);
      expect(fetchCount).toBe(0);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
  it("getPoiLabel is pure (same input → same output, no fetch)", () => {
    const origFetch = (globalThis as any).fetch;
    let fetchCount = 0;
    (globalThis as any).fetch = (...args: unknown[]) => {
      fetchCount++;
      return origFetch?.(...args);
    };
    try {
      const a = getPoiLabel({ accepted: false });
      const b = getPoiLabel({ accepted: false });
      expect(a).toEqual(b);
      expect(fetchCount).toBe(0);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
});

describe("DEC-005 / DEC-006 — prebuild wiring", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const prebuild = pkg.scripts?.prebuild ?? "";

  it("check-engagement-wording.mjs is wired into prebuild", () => {
    expect(prebuild).toContain("scripts/check-engagement-wording.mjs");
  });
  it("check-dec-005-006-audit-names.mjs is wired into prebuild", () => {
    expect(prebuild).toContain("scripts/check-dec-005-006-audit-names.mjs");
  });
});

describe("DEC-005 / DEC-006 — no Phase 2 fake runtime emission", () => {
  // Phase 1 is SSOT-only. Helpers must not yet emit canonical audit names.
  const preSrc = readFileSync("src/lib/legal/pre-acceptance-wording.ts", "utf8");
  const poiSrc = readFileSync("src/lib/legal/poi-wording.ts", "utf8");
  it.each([
    "legal.pre_acceptance_wording_applied",
    "legal.unsafe_pre_acceptance_wording_blocked",
    "counterparty.acceptance_recorded_wording_state_updated",
    "legal.poi_binding_wording_applied",
    "legal.unsafe_poi_binding_claim_blocked",
    "legal.poi_wording_updated_after_counterparty_acceptance",
  ])("wording helper does not fake-emit canonical name %s", (name) => {
    // The audit-key reference inside getPoiLabel's PoiLabel type is the
    // only allowed mention; helpers themselves must not write audit rows.
    expect(preSrc).not.toContain(`"${name}"`);
    // poi-wording.ts is allowed to *type-reference* poi_binding_wording_applied
    // via PoiLabel.auditKey but must not emit it as a runtime side effect.
    if (name !== "legal.poi_binding_wording_applied") {
      expect(poiSrc).not.toContain(`"${name}"`);
    }
  });
});
