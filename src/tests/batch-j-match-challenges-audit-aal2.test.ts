/**
 * Batch J — match-challenges audit + AAL2 source-pin suite.
 *
 * Pins the wiring of:
 *
 *   F1 — writeChallengeAudit() called from EVERY success branch:
 *        raise / comment / transition / upload-evidence / break-glass.
 *
 *   F2 — AAL2 enforcement (requireAal2) on sensitive transitions:
 *        outcome_recorded, closed_no_action, any platform_admin
 *        override transition, and break-glass.
 *
 * Edge functions are exercised at runtime by `match_challenges_lifecycle_test.ts`
 * (Deno). This file pins the contract from the Vitest+jsdom harness so a
 * future refactor cannot silently drop the audit/AAL2 hooks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SRC = readFileSync(
  path.join(process.cwd(), "supabase/functions/match-challenges/index.ts"),
  "utf8",
);

const ACTIONS = [
  "match_challenge.raised",
  "match_challenge.commented",
  "match_challenge.transitioned",
  "match_challenge.evidence_uploaded",
  "match_challenge.break_glass",
] as const;

describe("Batch J F1 — writeChallengeAudit wiring", () => {
  it("declares the helper and the five canonical action codes", () => {
    expect(SRC).toMatch(/async function writeChallengeAudit/);
    for (const action of ACTIONS) {
      expect(SRC).toContain(`"${action}"`);
    }
  });

  it("invokes writeChallengeAudit from at least 5 distinct success branches", () => {
    const calls = SRC.match(/writeChallengeAudit\(admin,\s*\{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("each canonical action is emitted by an audit call site", () => {
    for (const action of ACTIONS) {
      const re = new RegExp(`action:\\s*"${action.replace(/\./g, "\\.")}"`);
      expect(re.test(SRC)).toBe(true);
    }
  });
});

describe("Batch J F2 — AAL2 enforcement", () => {
  it("imports the AAL2 helper and defines a requireAal2 wrapper", () => {
    expect(SRC).toMatch(/from "..\/_shared\/aal\.ts"/);
    expect(SRC).toMatch(/async function requireAal2/);
    expect(SRC).toMatch(/"MFA_REQUIRED"/);
  });

  it("gates break-glass on AAL2", () => {
    const slice = SRC.split('case "break-glass"')[1] ?? "";
    expect(slice).toMatch(/requireAal2\(admin,\s*authHeader/);
    expect(slice).toMatch(/match_challenge\.break_glass/);
  });

  it("gates transition on closure + platform_admin overrides", () => {
    const slice = SRC.split('case "transition"')[1] ?? "";
    expect(slice).toMatch(/p\.to_status === "outcome_recorded"/);
    expect(slice).toMatch(/p\.to_status === "closed_no_action"/);
    expect(slice).toMatch(/isPlatformAdmin && p\.to_status !== "withdrawn"/);
    expect(slice).toMatch(/requireAal2\(/);
  });

  it("writes match_challenge.mfa_required_denied on aal2 failure", () => {
    expect(SRC).toMatch(/"match_challenge\.mfa_required_denied"/);
  });
});
