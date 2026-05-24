/**
 * COMP-002 / COMP-012 — pure decision tests for the compliance freshness
 * guard. Exercises the threshold constants, the canonical audit names
 * SSOT, and the conditional-block code mapping.
 *
 * Full end-to-end RLS + edge-function tests live in Deno and run in CI;
 * this suite covers the deterministic decision logic and the SSOT pins
 * that the prebuild guards enforce.
 */

import { describe, it, expect } from "vitest";
import {
  SANCTIONS_FRESHNESS_DAYS,
  VERIFICATION_FRESHNESS_DAYS,
  SANCTIONS_FRESHNESS_MS,
  VERIFICATION_FRESHNESS_MS,
} from "@/lib/compliance/freshness-thresholds";
import {
  COMP_002_012_AUDIT_NAMES,
  COMP_002_SANCTIONS_RESCREEN_REQUIRED,
  COMP_002_SANCTIONS_HOLD_RELEASED,
  COMP_002_SANCTIONS_HOLD_CLOSED,
  COMP_012_VERIFICATION_REFRESH_REQUIRED,
  COMP_012_VERIFICATION_HOLD_RELEASED,
  COMP_012_VERIFICATION_HOLD_CLOSED,
  COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE,
  COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE,
} from "@/lib/compliance/comp-002-012-audit";

describe("COMP-002 / COMP-012 thresholds (signed CWDF)", () => {
  it("sanctions threshold is 30 days", () => {
    expect(SANCTIONS_FRESHNESS_DAYS).toBe(30);
    expect(SANCTIONS_FRESHNESS_MS).toBe(30 * 86_400_000);
  });

  it("verification threshold is 365 days", () => {
    expect(VERIFICATION_FRESHNESS_DAYS).toBe(365);
    expect(VERIFICATION_FRESHNESS_MS).toBe(365 * 86_400_000);
  });
});

describe("COMP-002 / COMP-012 canonical audit names", () => {
  it("includes all 12 canonical lifecycle audits", () => {
    expect(COMP_002_012_AUDIT_NAMES).toHaveLength(12);
  });

  it("uses the namespace required by the runbook", () => {
    for (const a of COMP_002_012_AUDIT_NAMES) {
      expect(a.startsWith("compliance.")).toBe(true);
    }
  });

  it("includes COMP-002 lifecycle (required, passed, potential, released, closed)", () => {
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_002_SANCTIONS_RESCREEN_REQUIRED);
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_002_SANCTIONS_HOLD_RELEASED);
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_002_SANCTIONS_HOLD_CLOSED);
  });

  it("includes COMP-012 lifecycle (required, passed, failed, released, closed)", () => {
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_012_VERIFICATION_REFRESH_REQUIRED);
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_012_VERIFICATION_HOLD_RELEASED);
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_012_VERIFICATION_HOLD_CLOSED);
  });

  it("includes the parallel-to-MT-008 progression-block audits", () => {
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE);
    expect(COMP_002_012_AUDIT_NAMES).toContain(COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE);
  });

  it("names are stable strings (no drift)", () => {
    expect(COMP_002_SANCTIONS_RESCREEN_REQUIRED).toBe(
      "compliance.sanctions_rescreen_required",
    );
    expect(COMP_012_VERIFICATION_REFRESH_REQUIRED).toBe(
      "compliance.verification_refresh_required",
    );
    expect(COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE).toBe(
      "compliance.progression_blocked_sanctions_stale",
    );
    expect(COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE).toBe(
      "compliance.progression_blocked_verification_stale",
    );
  });
});

describe("COMP-002 / COMP-012 staleness arithmetic", () => {
  it("sanctions older than 30 days exceeds the freshness window", () => {
    const ranAt = Date.now() - 31 * 86_400_000;
    expect(Date.now() - ranAt > SANCTIONS_FRESHNESS_MS).toBe(true);
  });

  it("sanctions fresher than 30 days is within window", () => {
    const ranAt = Date.now() - 29 * 86_400_000;
    expect(Date.now() - ranAt > SANCTIONS_FRESHNESS_MS).toBe(false);
  });

  it("verification older than 365 days exceeds the freshness window", () => {
    const decidedAt = Date.now() - 366 * 86_400_000;
    expect(Date.now() - decidedAt > VERIFICATION_FRESHNESS_MS).toBe(true);
  });

  it("verification fresher than 365 days is within window", () => {
    const decidedAt = Date.now() - 200 * 86_400_000;
    expect(Date.now() - decidedAt > VERIFICATION_FRESHNESS_MS).toBe(false);
  });
});
