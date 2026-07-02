/**
 * Batch V — Controlled-action gate tests.
 *
 * Proves the blocking-status list is exhaustive, that null / undefined
 * are treated as blocking, and that the server mirror agrees.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  IDV_BLOCKING_STATUSES,
  isIdvBlocking,
  isIdvCompleted,
  CONTROLLED_ACTIONS,
  idvBlockUserWording,
} from "@/lib/idv/controlled-action-gate";

describe("Batch V — controlled-action gate", () => {
  it.each(IDV_BLOCKING_STATUSES as unknown as string[])(
    "%s is blocking",
    (s) => expect(isIdvBlocking(s)).toBe(true),
  );

  it("null / undefined are treated as blocking (fail-closed)", () => {
    expect(isIdvBlocking(null)).toBe(true);
    expect(isIdvBlocking(undefined)).toBe(true);
    expect(isIdvBlocking("")).toBe(true);
  });

  it("only 'idv_completed' is non-blocking / completed", () => {
    expect(isIdvBlocking("idv_completed")).toBe(false);
    expect(isIdvCompleted("idv_completed")).toBe(true);
    expect(isIdvCompleted("manual_review_required")).toBe(false);
  });

  it("user wording is provider-neutral (no forbidden trust signals)", () => {
    const bannedFragments = [
      "verified", "cleared", "passed", "approved", "risk-free",
    ];
    for (const s of IDV_BLOCKING_STATUSES) {
      const w = idvBlockUserWording(s).toLowerCase();
      for (const b of bannedFragments) {
        expect(w).not.toContain(b);
      }
    }
  });

  it("controlled-action list covers WaD seal, finality, funder-ready, API ready=true, POI-bind", () => {
    expect(CONTROLLED_ACTIONS).toEqual([
      "wad_seal",
      "finality_action",
      "funder_ready_grant",
      "api_ready_true",
      "poi_bind_party",
    ]);
  });

  it("server mirror declares the same blocking set", () => {
    const server = readFileSync(
      "supabase/functions/_shared/idv-gate.ts",
      "utf8",
    );
    for (const s of IDV_BLOCKING_STATUSES) {
      expect(server).toContain(`"${s}"`);
    }
  });

  it("WaD seal path in the edge function calls the IDV gate", () => {
    const wad = readFileSync("supabase/functions/wad/index.ts", "utf8");
    expect(wad).toContain("assertWadSealIdvGate");
    expect(wad).toContain("IDV_REQUIRED_WAD_SEAL");
  });
});
