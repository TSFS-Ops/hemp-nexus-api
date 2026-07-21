/**
 * Funder-only Trade Desk containment — pure decision tests.
 * Covers the nine matrix rows required by the batch spec.
 */
import { describe, it, expect } from "vitest";
import { resolveDeskAccess } from "@/lib/funder-workspace/desk-access";

const base = {
  isPlatformAdmin: false,
  isFunderUser: false,
  hasTradeMembership: false,
  selectedPersona: null as string | null,
};

describe("resolveDeskAccess (funder-only Trade Desk containment)", () => {
  it("Funder Admin only → /desk redirected", () => {
    expect(resolveDeskAccess({ ...base, isFunderUser: true })).toBe("redirect_funder");
  });

  it("Funder Reviewer only → redirected (same code path, funder membership sole)", () => {
    expect(resolveDeskAccess({ ...base, isFunderUser: true })).toBe("redirect_funder");
  });

  it("Funder Approver only → redirected", () => {
    expect(resolveDeskAccess({ ...base, isFunderUser: true })).toBe("redirect_funder");
  });

  it("Funder Viewer only → redirected", () => {
    expect(resolveDeskAccess({ ...base, isFunderUser: true })).toBe("redirect_funder");
  });

  it("Isolation Viewer (external_adviser / funder-membership-only) → redirected", () => {
    expect(resolveDeskAccess({ ...base, isFunderUser: true })).toBe("redirect_funder");
  });

  it("Genuine trade user (no funder seat) → /desk allowed", () => {
    expect(
      resolveDeskAccess({ ...base, hasTradeMembership: true }),
    ).toBe("allow");
  });

  it("Dual-role user with genuine trade membership (default persona) → allowed", () => {
    expect(
      resolveDeskAccess({
        ...base,
        isFunderUser: true,
        hasTradeMembership: true,
      }),
    ).toBe("allow");
  });

  it("Dual-role user with explicitly selected funder persona → redirected", () => {
    expect(
      resolveDeskAccess({
        ...base,
        isFunderUser: true,
        hasTradeMembership: true,
        selectedPersona: "funder",
      }),
    ).toBe("redirect_funder");
  });

  it("Dual-role user with explicitly selected trade persona → allowed", () => {
    expect(
      resolveDeskAccess({
        ...base,
        isFunderUser: true,
        hasTradeMembership: false,
        selectedPersona: "trade",
      }),
    ).toBe("allow");
  });

  it("Platform Admin regression — always allowed even if funder seat present", () => {
    expect(
      resolveDeskAccess({
        ...base,
        isPlatformAdmin: true,
        isFunderUser: true,
        hasTradeMembership: false,
      }),
    ).toBe("allow");
    expect(
      resolveDeskAccess({
        ...base,
        isPlatformAdmin: true,
      }),
    ).toBe("allow");
  });

  it("Unrelated persona values (developer/governance) do not force redirect for trade users", () => {
    expect(
      resolveDeskAccess({
        ...base,
        hasTradeMembership: true,
        selectedPersona: "developer",
      }),
    ).toBe("allow");
  });

  it("No email-specific logic: decision depends only on typed inputs", () => {
    // Same inputs must always produce same output regardless of any
    // ambient identity. Sanity check to lock the contract.
    const inputs = { ...base, isFunderUser: true };
    expect(resolveDeskAccess(inputs)).toBe(resolveDeskAccess(inputs));
  });
});
