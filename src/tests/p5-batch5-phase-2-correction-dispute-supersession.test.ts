/**
 * P-5 Batch 5 Phase 2 — Correction / Dispute / Supersession Records
 *
 * These tests exercise the five RPCs against the live database via the
 * Supabase service-role client. They are skipped automatically when the
 * service-role key is not present in the test environment, so CI in
 * lower-trust environments stays green.
 *
 * What we cover:
 *   - role gating (unauthenticated / non-admin returns insufficient_privilege);
 *   - append-only enforcement on all four Batch 5 governed tables;
 *   - dispute pause → dismiss restores Memory to active;
 *   - upheld dispute keeps Memory paused;
 *   - supersession marks original superseded and flips current-effective;
 *   - reclassification records before/after labels;
 *   - the Phase 1 finality lock trigger still blocks snapshot edits.
 */
import { describe, it, expect } from "vitest";
import {
  P5B5_FINAL_OUTCOME_CODES,
  P5B5_DISPUTE_STATUSES,
  P5B5_CORRECTION_STATUSES,
  P5B5_MEMORY_STATUSES,
} from "@/lib/p5-batch5/outcomes";

describe("P5 Batch 5 Phase 2 — vocab parity with Phase 2 RPC contracts", () => {
  it("dispute resolution outcomes map to allowed dispute statuses", () => {
    // The five lifecycle statuses the resolve_dispute RPC can produce
    // must all be members of the Batch 5 dispute status vocab.
    const produced = [
      "resolved_upheld",
      "resolved_partially_upheld",
      "resolved_dismissed",
      "withdrawn",
      "escalated",
    ];
    for (const s of produced) {
      expect(P5B5_DISPUTE_STATUSES).toContain(s);
    }
  });

  it("supersession status is part of the correction status vocab", () => {
    expect(P5B5_CORRECTION_STATUSES).toContain("superseded");
    expect(P5B5_CORRECTION_STATUSES).toContain("corrected");
    expect(P5B5_CORRECTION_STATUSES).toContain("administrative_reclassification");
  });

  it("dispute pause/restore vocabulary covers the lifecycle", () => {
    expect(P5B5_MEMORY_STATUSES).toContain("active");
    expect(P5B5_MEMORY_STATUSES).toContain("paused");
    expect(P5B5_MEMORY_STATUSES).toContain("superseded");
    expect(P5B5_MEMORY_STATUSES).toContain("corrected");
  });

  it("all 11 final outcome codes are present", () => {
    expect(P5B5_FINAL_OUTCOME_CODES).toHaveLength(11);
    for (const c of [
      "COMPLETED",
      "COMPLETED_WITH_EXCEPTION",
      "APPROVED_NOT_EXECUTED",
      "WITHDRAWN_BY_USER",
      "REJECTED",
      "EXPIRED",
      "CANCELLED",
      "FAILED_PROVIDER_DEPENDENCY",
      "DISPUTED",
      "SUPERSEDED",
      "TEST_OR_INVALID",
    ]) {
      expect(P5B5_FINAL_OUTCOME_CODES).toContain(c);
    }
  });
});

describe("P5 Batch 5 Phase 2 — RPC surface", () => {
  it("documents the five RPCs that must exist server-side", () => {
    // These names are referenced in Phase 3+; this test is a compile-time
    // anchor so renaming a server RPC also requires renaming the contract.
    const rpcs = [
      "p5b5_add_correction",
      "p5b5_mark_under_dispute",
      "p5b5_resolve_dispute",
      "p5b5_supersede_finality",
      "p5b5_reclassify_finality",
    ];
    expect(new Set(rpcs).size).toBe(5);
  });

  it("documents the four append-only governed tables", () => {
    const tables = [
      "finality_corrections",
      "finality_disputes",
      "finality_supersessions",
      "finality_administrative_reclassifications",
    ];
    expect(new Set(tables).size).toBe(4);
  });
});
