/**
 * Batch 20 — Pre-UAT Embarrassment Audit invariant tests.
 *
 * Asserts the highest-risk embarrassment fences are still in place. These
 * tests are deliberately thin and SSOT-driven; deep behavioural coverage
 * lives in the per-batch tests for Batches 1–19B.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { BATCH_19A_SAMPLE_ONLY_RECORDS } from "@/lib/registry-client-decisions-19a";
import {
  BATCH_19B_CLAIM_APPROVED_LIMITED_COPY,
  BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK,
  BATCH_19B_SAMPLE_ONLY_API_CONTRACT,
} from "@/lib/registry-client-decisions-19b";
import {
  REGISTRY_READINESS_COPY,
  isProductionReady,
} from "@/lib/registry-readiness";

describe("Batch 20 — Pre-UAT Embarrassment Audit", () => {
  it("the five client records are locked sample_only and excluded from production API", () => {
    const ids = BATCH_19A_SAMPLE_ONLY_RECORDS.map((r: any) => r.id ?? r);
    expect(ids).toEqual(
      expect.arrayContaining([
        "bullion_bathrooms_nigeria",
        "dangote_fertiliser_limited",
        "harith_holdings",
        "laurium_capital",
        "starfair_162",
      ]),
    );
    expect(BATCH_19B_SAMPLE_ONLY_API_CONTRACT.production_api).toBe("excluded");
    expect(BATCH_19B_SAMPLE_ONLY_API_CONTRACT.sandbox_verified_by_izenzo).toBe(false);
  });

  it("claim approval is claim_approved_limited and does not unlock authority/bank/API", () => {
    expect(BATCH_19B_CLAIM_APPROVED_LIMITED_COPY.toLowerCase()).toContain(
      "not verified by this claim approval",
    );
    const list = BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK.join("|").toLowerCase();
    expect(list).toMatch(/authority/);
    expect(list).toMatch(/bank/);
    expect(list).toMatch(/api/);
  });

  it("readiness copy never asserts production readiness on non-production states", () => {
    for (const [state, copy] of Object.entries(REGISTRY_READINESS_COPY)) {
      if (isProductionReady(state as any)) continue;
      expect(copy.toLowerCase()).not.toMatch(/\bproduction[- ]ready\b/);
      expect(copy.toLowerCase()).not.toMatch(/\bguaranteed\b/);
    }
  });

  it("Batch 20 evidence README documents the audit and final status token", () => {
    const body = readFileSync(
      "evidence/batch-20-pre-uat-embarrassment-audit/README.md",
      "utf8",
    );
    expect(body).toContain("BATCH_20_PRE_UAT_EMBARRASSMENT_AUDIT_COMPLETE");
    for (const cat of [
      "uat_blocker",
      "uat_risk",
      "cosmetic",
      "deferred_non_blocking",
      "accepted_limitation",
    ]) {
      expect(body).toContain(cat);
    }
  });

  it("central registry evidence index references Batches 1–19B and 20", () => {
    const idx = readFileSync(
      "evidence/registry-evidence-index/README.md",
      "utf8",
    );
    for (const row of ["| 1 |", "| 11 |", "| 18 |", "| 19A |", "| 19B |", "| 20 |"]) {
      expect(idx).toContain(row);
    }
  });
});
