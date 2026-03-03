/**
 * POI State Machine — Acceptance Tests
 * 
 * These tests validate the deterministic state machine rules
 * as specified in the P-3 Phase 1 requirements.
 * 
 * Run with: npx vitest run src/tests/poi-state-machine.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  validateTransition,
  isMutable,
  VALID_TRANSITIONS,
  POI_STATES,
  type PoiState,
} from "@/lib/modules/poi-engine/state-machine";

describe("POI State Machine — Acceptance Tests", () => {
  // ── Test 1: DRAFT → COLLAPSED must fail ──
  describe("Test 1: Cannot skip states (DRAFT → COLLAPSED)", () => {
    it("should reject a direct transition from DRAFT to COLLAPSED", () => {
      const error = validateTransition("DRAFT", "COLLAPSED");
      expect(error).not.toBeNull();
      expect(error).toContain("not permitted");
    });

    it("should reject DRAFT → ELIGIBLE (must go via PENDING_APPROVAL)", () => {
      const error = validateTransition("DRAFT", "ELIGIBLE");
      expect(error).not.toBeNull();
    });

    it("should reject DRAFT → ANNULLED", () => {
      const error = validateTransition("DRAFT", "ANNULLED");
      expect(error).not.toBeNull();
    });

    it("should allow valid DRAFT transitions only", () => {
      expect(validateTransition("DRAFT", "PENDING_APPROVAL")).toBeNull();
      expect(validateTransition("DRAFT", "EXPIRED")).toBeNull();
      expect(validateTransition("DRAFT", "REJECTED")).toBeNull();
    });
  });

  // ── Test 2: COLLAPSED POI is immutable ──
  describe("Test 2: COLLAPSED POI is immutable", () => {
    it("should report COLLAPSED as not mutable", () => {
      expect(isMutable("COLLAPSED")).toBe(false);
    });

    it("should only allow COLLAPSED → ANNULLED", () => {
      const allowed = VALID_TRANSITIONS["COLLAPSED"];
      expect(allowed).toEqual(["ANNULLED"]);
    });

    it("should reject COLLAPSED → DRAFT", () => {
      const error = validateTransition("COLLAPSED", "DRAFT");
      expect(error).not.toBeNull();
    });

    it("should reject COLLAPSED → PENDING_APPROVAL", () => {
      const error = validateTransition("COLLAPSED", "PENDING_APPROVAL");
      expect(error).not.toBeNull();
    });

    it("should reject COLLAPSED → COLLAPSED (same state)", () => {
      const error = validateTransition("COLLAPSED", "COLLAPSED");
      expect(error).not.toBeNull();
      expect(error).toContain("same state");
    });
  });

  // ── Test 3: ANNULLED flow ──
  describe("Test 3: ANNULLED flow", () => {
    it("should allow COLLAPSED → ANNULLED", () => {
      const error = validateTransition("COLLAPSED", "ANNULLED");
      expect(error).toBeNull();
    });

    it("should report ANNULLED as terminal (no further transitions)", () => {
      const allowed = VALID_TRANSITIONS["ANNULLED"];
      expect(allowed).toEqual([]);
    });

    it("should report ANNULLED as immutable", () => {
      expect(isMutable("ANNULLED")).toBe(false);
    });
  });

  // ── Test 4: Full valid lifecycle path ──
  describe("Test 4: Full valid lifecycle path", () => {
    it("should validate the complete happy path", () => {
      const path: [PoiState, PoiState][] = [
        ["DRAFT", "PENDING_APPROVAL"],
        ["PENDING_APPROVAL", "ELIGIBLE"],
        ["ELIGIBLE", "COLLAPSE_REQUESTED"],
        ["COLLAPSE_REQUESTED", "COLLAPSED"],
      ];

      for (const [from, to] of path) {
        const error = validateTransition(from, to);
        expect(error).toBeNull();
      }
    });

    it("should validate the annulment path after collapse", () => {
      expect(validateTransition("COLLAPSED", "ANNULLED")).toBeNull();
    });
  });

  // ── Additional edge cases ──
  describe("Edge cases", () => {
    it("should reject invalid state names", () => {
      const error = validateTransition("INVALID" as PoiState, "DRAFT");
      expect(error).toContain("Invalid current state");
    });

    it("should reject transitions from terminal states", () => {
      expect(validateTransition("EXPIRED", "DRAFT")).not.toBeNull();
      expect(validateTransition("REJECTED", "DRAFT")).not.toBeNull();
    });

    it("should have all POI states defined in transitions map", () => {
      for (const state of POI_STATES) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
      }
    });

    it("should ensure COLLAPSE_REQUESTED cannot bypass to ANNULLED", () => {
      const error = validateTransition("COLLAPSE_REQUESTED", "ANNULLED");
      expect(error).not.toBeNull();
    });
  });
});
