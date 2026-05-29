/**
 * Batch 3 — Source-pin tests proving staging password edge functions
 * enforce AAL2 (MFA) in addition to admin/platform-admin checks.
 *
 * These mirror the pattern used by admin-legal-hold, which is the
 * reference AAL2 implementation in this repo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SET_SRC = readFileSync(
  resolve(__dirname, "..", "..", "supabase/functions/staging-set-fixture-password/index.ts"),
  "utf8",
);
const REVEAL_SRC = readFileSync(
  resolve(__dirname, "..", "..", "supabase/functions/staging-reveal-fixture-password/index.ts"),
  "utf8",
);

describe("Batch 3 — staging-set-fixture-password AAL2 wiring", () => {
  it("imports assertAal2 from the shared aal helper", () => {
    expect(SET_SRC).toMatch(/import\s*\{[^}]*assertAal2[^}]*\}\s*from\s*"\.\.\/_shared\/aal\.ts"/);
  });

  it("calls assertAal2 with the auth header after the admin check", () => {
    expect(SET_SRC).toMatch(/assertAal2\(authHeader/);
    const adminIdx = SET_SRC.indexOf('"is_admin"');
    const aalIdx = SET_SRC.indexOf("assertAal2(authHeader");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(aalIdx).toBeGreaterThan(adminIdx);
  });

  it("returns 403 + code MFA_REQUIRED on AAL2 failure", () => {
    expect(SET_SRC).toMatch(/code:\s*"MFA_REQUIRED"/);
    expect(SET_SRC).toMatch(/MFA_REQUIRED[\s\S]{0,80}403/);
  });

  it("preserves the staging-only environment gate", () => {
    expect(SET_SRC).toMatch(/STAGING_ONLY/);
    expect(SET_SRC).toMatch(/isStagingTier\(\)/);
  });

  it("preserves the admin-only RBAC check", () => {
    expect(SET_SRC).toMatch(/"is_admin"/);
    expect(SET_SRC).toMatch(/Admin access required/);
  });
});

describe("Batch 3 — staging-reveal-fixture-password AAL2 wiring", () => {
  it("imports assertAal2 from the shared aal helper", () => {
    expect(REVEAL_SRC).toMatch(/import\s*\{[^}]*assertAal2[^}]*\}\s*from\s*"\.\.\/_shared\/aal\.ts"/);
  });

  it("calls assertAal2 with the auth header after the admin check", () => {
    expect(REVEAL_SRC).toMatch(/assertAal2\(authHeader/);
    const adminIdx = REVEAL_SRC.indexOf('"is_admin"');
    const aalIdx = REVEAL_SRC.indexOf("assertAal2(authHeader");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(aalIdx).toBeGreaterThan(adminIdx);
  });

  it("returns 403 + code MFA_REQUIRED on AAL2 failure", () => {
    expect(REVEAL_SRC).toMatch(/code:\s*"MFA_REQUIRED"/);
    expect(REVEAL_SRC).toMatch(/MFA_REQUIRED[\s\S]{0,80}403/);
  });

  it("preserves the staging-only environment gate", () => {
    expect(REVEAL_SRC).toMatch(/STAGING_ONLY/);
    expect(REVEAL_SRC).toMatch(/isStagingTier\(\)/);
  });

  it("preserves the admin-only RBAC check", () => {
    expect(REVEAL_SRC).toMatch(/"is_admin"/);
    expect(REVEAL_SRC).toMatch(/Admin access required/);
  });
});
