/**
 * POI State Machine - Acceptance Tests
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

describe("POI State Machine - Acceptance Tests", () => {
  // ── Test 1: DRAFT → COMPLETED must fail ──
  describe("Test 1: Cannot skip states (DRAFT → COMPLETED)", () => {
    it("should reject a direct transition from DRAFT to COMPLETED", () => {
      const error = validateTransition("DRAFT", "COMPLETED");
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

  // ── Test 2: COMPLETED POI is immutable ──
  describe("Test 2: COMPLETED POI is immutable", () => {
    it("should report COMPLETED as not mutable", () => {
      expect(isMutable("COMPLETED")).toBe(false);
    });

    it("should only allow COMPLETED → ANNULLED", () => {
      const allowed = VALID_TRANSITIONS["COMPLETED"];
      expect(allowed).toEqual(["ANNULLED"]);
    });

    it("should reject COMPLETED → DRAFT", () => {
      const error = validateTransition("COMPLETED", "DRAFT");
      expect(error).not.toBeNull();
    });

    it("should reject COMPLETED → PENDING_APPROVAL", () => {
      const error = validateTransition("COMPLETED", "PENDING_APPROVAL");
      expect(error).not.toBeNull();
    });

    it("should reject COMPLETED → COMPLETED (same state)", () => {
      const error = validateTransition("COMPLETED", "COMPLETED");
      expect(error).not.toBeNull();
      expect(error).toContain("same state");
    });
  });

  // ── Test 3: ANNULLED flow ──
  describe("Test 3: ANNULLED flow", () => {
    it("should allow COMPLETED → ANNULLED", () => {
      const error = validateTransition("COMPLETED", "ANNULLED");
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
        ["ELIGIBLE", "COMPLETION_REQUESTED"],
        ["COMPLETION_REQUESTED", "COMPLETED"],
      ];

      for (const [from, to] of path) {
        const error = validateTransition(from, to);
        expect(error).toBeNull();
      }
    });

    it("should validate the annulment path after collapse", () => {
      expect(validateTransition("COMPLETED", "ANNULLED")).toBeNull();
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

    it("should have all Intent states defined in transitions map", () => {
      for (const state of POI_STATES) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
      }
    });

    it("should ensure COMPLETION_REQUESTED cannot bypass to ANNULLED", () => {
      const error = validateTransition("COMPLETION_REQUESTED", "ANNULLED");
      expect(error).not.toBeNull();
    });
  });
});
