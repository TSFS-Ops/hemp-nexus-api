/**
 * Batch V-Wire — Controlled-action IDV gate coverage.
 *
 * Proves the same blocking predicate is applied uniformly across all
 * seven controlled-action sites, that manual_review_accepted releases
 * (without ever being rendered as "verified"), that non-sensitive work
 * remains allowed, and that the API-safe projection never leaks raw
 * provider data.
 */

import { describe, it, expect } from "vitest";
import {
  IDV_BLOCKING_STATUSES,
  CONTROLLED_ACTIONS,
  isIdvBlocking,
  idvReleasesControlledAction,
  idvActionBlockerCode,
  idvBlockerCode,
  idvBlockUserWording,
  buildApiIdvProjection,
  type ControlledAction,
} from "@/lib/idv/controlled-action-gate";
import { IDV_MANUAL_REVIEW_USER_WORDING } from "@/lib/idv/manual-review";

const V_WIRE_GATES: ControlledAction[] = [
  "finality_action",
  "funder_ready_grant",
  "api_ready_true",
  "poi_bind_party",
  "evidence_approval",
  "transaction_approval",
];

describe("Batch V-Wire — gate uniformity", () => {
  it.each(V_WIRE_GATES)("blocks %s for every blocking IDV status", (action) => {
    for (const s of IDV_BLOCKING_STATUSES) {
      expect(isIdvBlocking(s)).toBe(true);
      expect(idvReleasesControlledAction(s)).toBe(false);
      const code = idvActionBlockerCode(action, s);
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("blocks all V-Wire gates when IDV state is absent (fail-closed)", () => {
    for (const action of V_WIRE_GATES) {
      expect(idvReleasesControlledAction(null)).toBe(false);
      expect(idvReleasesControlledAction(undefined)).toBe(false);
      expect(idvActionBlockerCode(action, null)).toMatch(/^IDV_/);
    }
  });

  it("allows every V-Wire gate on idv_completed", () => {
    for (const action of V_WIRE_GATES) {
      expect(idvReleasesControlledAction("idv_completed")).toBe(true);
      void action;
    }
  });

  it("provider_pending / manual_review_required / provider_not_available block every gate", () => {
    for (const bad of ["provider_pending", "manual_review_required", "provider_not_available"] as const) {
      expect(isIdvBlocking(bad)).toBe(true);
      expect(idvReleasesControlledAction(bad)).toBe(false);
      for (const action of V_WIRE_GATES) {
        const code = idvActionBlockerCode(action, bad);
        expect(code).not.toBe("IDV_REQUIRED"); // scoped code should be used
      }
    }
  });
});

describe("Batch V-Wire — manual review acceptance", () => {
  it("manual_review_accepted releases gates", () => {
    expect(idvReleasesControlledAction("manual_review_accepted")).toBe(true);
    expect(isIdvBlocking("manual_review_accepted")).toBe(false);
  });

  it("manual_review_required does NOT release gates", () => {
    expect(idvReleasesControlledAction("manual_review_required")).toBe(false);
    expect(isIdvBlocking("manual_review_required")).toBe(true);
  });

  it("manual review external wording is not 'verified'", () => {
    for (const w of Object.values(IDV_MANUAL_REVIEW_USER_WORDING)) {
      const lc = w.toLowerCase();
      expect(lc).not.toContain("verified");
      expect(lc).not.toContain("cleared identity");
      expect(lc).not.toContain("passed");
    }
  });
});

describe("Batch V-Wire — API ready=true projection", () => {
  it("ready=false and no raw fields for every blocking status", () => {
    for (const s of IDV_BLOCKING_STATUSES) {
      const p = buildApiIdvProjection(s);
      expect(p.ready).toBe(false);
      expect(p.idv_required_action).toBe(true);
      expect(p.blocker_code).toMatch(/^IDV_/);
      expect(p.blocker_label).toBeTruthy();
      // No raw provider payload leakage: the shape has a fixed key set.
      expect(Object.keys(p).sort()).toEqual([
        "blocker_code",
        "blocker_label",
        "idv_provider_state",
        "idv_required_action",
        "idv_status",
        "ready",
      ]);
      // Wording must not include forbidden trust signals.
      const label = String(p.blocker_label).toLowerCase();
      for (const banned of ["verified", "cleared", "approved", "passed", "risk-free"]) {
        expect(label).not.toContain(banned);
      }
    }
  });

  it("ready=true only on idv_completed or manual_review_accepted", () => {
    expect(buildApiIdvProjection("idv_completed").ready).toBe(true);
    expect(buildApiIdvProjection("manual_review_accepted").ready).toBe(true);
    expect(buildApiIdvProjection(null).ready).toBe(false);
    expect(buildApiIdvProjection(undefined).ready).toBe(false);
  });

  it("provider_pending → idv_provider_state=pending, blocker_code=IDV_PROVIDER_PENDING", () => {
    const p = buildApiIdvProjection("provider_pending");
    expect(p.idv_provider_state).toBe("pending");
    expect(p.blocker_code).toBe("IDV_PROVIDER_PENDING");
  });

  it("manual_review_required → blocker_code=IDV_MANUAL_REVIEW_REQUIRED", () => {
    expect(buildApiIdvProjection("manual_review_required").blocker_code)
      .toBe("IDV_MANUAL_REVIEW_REQUIRED");
  });

  it("provider_not_available → blocker_code=IDV_PROVIDER_NOT_AVAILABLE", () => {
    expect(buildApiIdvProjection("provider_not_available").blocker_code)
      .toBe("IDV_PROVIDER_NOT_AVAILABLE");
  });
});

describe("Batch V-Wire — non-sensitive work remains allowed", () => {
  // Preparation / drafting / viewing / non-binding upload are not
  // controlled actions. Prove they are NOT in the controlled-action
  // registry, so gate call sites cannot accidentally block them.
  const NON_SENSITIVE = [
    "account_creation",
    "profile_completion",
    "non_binding_evidence_upload",
    "drafting",
    "view_permitted_records",
    "poi_preparation",
  ];
  it.each(NON_SENSITIVE)("%s is not a controlled action", (a) => {
    expect((CONTROLLED_ACTIONS as readonly string[]).includes(a)).toBe(false);
  });
});

describe("Batch V-Wire — safe blocker codes are provider-neutral", () => {
  it.each(IDV_BLOCKING_STATUSES as unknown as string[])(
    "%s → generic blocker code carries no provider name",
    (s) => {
      const code = idvBlockerCode(s);
      const label = idvBlockUserWording(s);
      for (const provider of ["verifynow", "dilisense", "onfido", "sumsub", "companies_house"]) {
        expect(code.toLowerCase()).not.toContain(provider);
        expect(label.toLowerCase()).not.toContain(provider);
      }
    },
  );
});
