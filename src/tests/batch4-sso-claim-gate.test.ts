/**
 * Batch 4 — SSO claim-gate + SCIM transition truth tables.
 *
 * Locks the two invariants the rest of the UI depends on:
 *   1. ssoClaimAllowed() returns true ONLY when status='live' AND
 *      last_test_result='pass' AND last_tested_at is set AND
 *      supabase_sso_provider_id is set.
 *   2. SCIM_TRANSITIONS matches the DB CHECK constraint exactly.
 */
import { describe, it, expect } from "vitest";
import {
  ssoClaimAllowed,
  ssoStatusLabel,
  isValidScimTransition,
  SCIM_TRANSITIONS,
  type SsoStatus,
  type ScimState,
} from "@/lib/identity/sso-claim";

const baseLive = {
  status: "live" as SsoStatus,
  last_test_result: "pass" as const,
  last_tested_at: "2026-05-29T00:00:00Z",
  supabase_sso_provider_id: "prov_abc",
};

describe("ssoClaimAllowed", () => {
  it("returns false for null/undefined", () => {
    expect(ssoClaimAllowed(null)).toBe(false);
    expect(ssoClaimAllowed(undefined)).toBe(false);
  });

  it("returns true only for fully-wired live config", () => {
    expect(ssoClaimAllowed(baseLive)).toBe(true);
  });

  it.each([
    ["status not_configured", { ...baseLive, status: "not_configured" as SsoStatus }],
    ["status pending_metadata", { ...baseLive, status: "pending_metadata" as SsoStatus }],
    ["status configured_not_connected", { ...baseLive, status: "configured_not_connected" as SsoStatus }],
    ["status failed", { ...baseLive, status: "failed" as SsoStatus }],
    ["status disabled", { ...baseLive, status: "disabled" as SsoStatus }],
    ["test result fail", { ...baseLive, last_test_result: "fail" as const }],
    ["test result null", { ...baseLive, last_test_result: null }],
    ["last_tested_at null", { ...baseLive, last_tested_at: null }],
    ["provider id null", { ...baseLive, supabase_sso_provider_id: null }],
    ["provider id empty", { ...baseLive, supabase_sso_provider_id: "" }],
  ])("returns false when %s", (_label, cfg) => {
    expect(ssoClaimAllowed(cfg)).toBe(false);
  });
});

describe("ssoStatusLabel — no marketing language", () => {
  const banned = ["enterprise", "bank-ready", "dfi", "world-class", "best-in-class"];
  it.each([
    "not_configured",
    "pending_metadata",
    "configured_not_connected",
    "live",
    "failed",
    "disabled",
  ] as const)("%s label contains no marketing words", (s) => {
    const label = ssoStatusLabel(s).toLowerCase();
    for (const b of banned) expect(label).not.toContain(b);
  });
});

describe("SCIM transitions", () => {
  it("rejects no-op transitions", () => {
    (["invited", "active", "suspended", "deprovisioned"] as ScimState[]).forEach((s) =>
      expect(isValidScimTransition(s, s)).toBe(false),
    );
  });

  it("allows the documented transitions", () => {
    for (const [from, tos] of Object.entries(SCIM_TRANSITIONS)) {
      for (const to of tos) {
        expect(isValidScimTransition(from as ScimState, to)).toBe(true);
      }
    }
  });

  it("blocks deprovisioned → active (must go via invited)", () => {
    expect(isValidScimTransition("deprovisioned", "active")).toBe(false);
    expect(isValidScimTransition("deprovisioned", "invited")).toBe(true);
  });

  it("blocks invited → invited and active → invited (no resurrection without deprovision)", () => {
    expect(isValidScimTransition("invited", "invited")).toBe(false);
    expect(isValidScimTransition("active", "invited")).toBe(false);
  });
});
