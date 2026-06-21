/**
 * Batch 17 — Registry admin operations centre — unit tests.
 * Covers SSOT parity helpers, SLA computation, work-item labels, risk
 * labels, severity tones, forbidden-word detection.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_OPS_WORK_ITEM_TYPES,
  REGISTRY_OPS_WORK_ITEM_LABEL,
  REGISTRY_OPS_SLA_STATES,
  REGISTRY_OPS_SLA_LABEL,
  REGISTRY_OPS_SLA_TONE,
  REGISTRY_OPS_SEVERITIES,
  REGISTRY_OPS_SEVERITY_TONE,
  REGISTRY_OPS_RISK_CATEGORIES,
  REGISTRY_OPS_RISK_CATEGORY_LABEL,
  REGISTRY_OPS_TILE_CODES,
  REGISTRY_OPS_TILE_LABEL,
  REGISTRY_OPS_SOURCE_MODULES,
  REGISTRY_OPS_DEFAULT_SLA_HOURS,
  REGISTRY_OPS_FORBIDDEN_WORDS,
  REGISTRY_OPS_FORBIDDEN_RAW_FIELDS,
  REGISTRY_OPS_SPECIALIST_ROUTES,
  computeSlaState,
  isProductionReadyClaim,
  safeWorkItemLabel,
  safeRiskLabel,
  safeSourceModuleLabel,
} from "@/lib/registry-operations-centre-ssot";

describe("Batch 17 — operations SSOT shape", () => {
  it("every work item type has a label", () => {
    for (const t of REGISTRY_OPS_WORK_ITEM_TYPES) {
      expect(REGISTRY_OPS_WORK_ITEM_LABEL[t]).toBeTruthy();
    }
  });
  it("every SLA state has a label and tone", () => {
    for (const s of REGISTRY_OPS_SLA_STATES) {
      expect(REGISTRY_OPS_SLA_LABEL[s]).toBeTruthy();
      expect(REGISTRY_OPS_SLA_TONE[s]).toBeTruthy();
    }
  });
  it("every risk category has a label", () => {
    for (const r of REGISTRY_OPS_RISK_CATEGORIES) {
      expect(REGISTRY_OPS_RISK_CATEGORY_LABEL[r]).toBeTruthy();
    }
  });
  it("every tile code has a label", () => {
    for (const c of REGISTRY_OPS_TILE_CODES) {
      expect(REGISTRY_OPS_TILE_LABEL[c]).toBeTruthy();
    }
  });
  it("every work item type has an SLA hours entry (number or null)", () => {
    for (const t of REGISTRY_OPS_WORK_ITEM_TYPES) {
      expect(t in REGISTRY_OPS_DEFAULT_SLA_HOURS).toBe(true);
    }
  });
  it("every severity has a tone", () => {
    for (const s of REGISTRY_OPS_SEVERITIES) {
      expect(REGISTRY_OPS_SEVERITY_TONE[s]).toBeTruthy();
    }
  });
  it("specialist route map only emits /admin/registry/* routes", () => {
    for (const r of Object.values(REGISTRY_OPS_SPECIALIST_ROUTES)) {
      expect(r.startsWith("/admin/registry")).toBe(true);
    }
  });
  it("source modules and forbidden lists are non-empty", () => {
    expect(REGISTRY_OPS_SOURCE_MODULES.length).toBeGreaterThan(0);
    expect(REGISTRY_OPS_FORBIDDEN_WORDS.length).toBeGreaterThan(0);
    expect(REGISTRY_OPS_FORBIDDEN_RAW_FIELDS.length).toBeGreaterThan(0);
  });
});

describe("Batch 17 — SLA computation", () => {
  it("returns within_sla when fresh", () => {
    expect(computeSlaState("claim_review", 1)).toBe("within_sla");
  });
  it("returns approaching_sla after 75% of SLA", () => {
    expect(computeSlaState("claim_review", 36.1)).toBe("approaching_sla");
  });
  it("returns sla_breached after SLA hours", () => {
    expect(computeSlaState("claim_review", 49)).toBe("sla_breached");
  });
  it("returns not_applicable for items with no SLA", () => {
    expect(computeSlaState("readiness_blocker", 1000)).toBe("not_applicable");
  });
  it("returns blocked when blocked flag set", () => {
    expect(computeSlaState("claim_review", 1000, true)).toBe("blocked");
  });
  it("returns paused when paused flag set (takes precedence)", () => {
    expect(computeSlaState("claim_review", 1000, true, true)).toBe("paused");
  });
});

describe("Batch 17 — forbidden wording", () => {
  it("flags auto-approve wording", () => {
    expect(isProductionReadyClaim("This will auto-approve the claim.")).toBe(true);
  });
  it("flags guaranteed wording", () => {
    expect(isProductionReadyClaim("Verification is guaranteed.")).toBe(true);
  });
  it("does not flag neutral admin copy", () => {
    expect(isProductionReadyClaim("Review and decide on this submission.")).toBe(false);
  });
});

describe("Batch 17 — safe label fallbacks", () => {
  it("safeWorkItemLabel returns label or fallback", () => {
    expect(safeWorkItemLabel("claim_review")).toBe(REGISTRY_OPS_WORK_ITEM_LABEL.claim_review);
    expect(safeWorkItemLabel("unknown_xyz")).toBe("Operations item");
  });
  it("safeRiskLabel returns label or fallback", () => {
    expect(safeRiskLabel("api_misuse_risk")).toBe(REGISTRY_OPS_RISK_CATEGORY_LABEL.api_misuse_risk);
    expect(safeRiskLabel("unknown")).toBe("Risk item");
  });
  it("safeSourceModuleLabel returns label or fallback", () => {
    expect(safeSourceModuleLabel("api")).toBe("Institutional API");
    expect(safeSourceModuleLabel("unknown")).toBe("Module");
  });
});
