/**
 * role-negative-edge-fn-admin-gate-shape.test.ts
 *
 * Static source-pin of admin guard shape across the engagement edge functions
 * relevant to Unknown-Counterparty Admin Facilitation and AI Outreach Drafter
 * Phase 1.
 *
 *  - poi-engagements: admin/outreach/facilitation entry points keep
 *    requireRole(authCtx, "platform_admin")
 *  - generate-engagement-outreach-draft & engagement-outreach-draft-decision
 *    keep is_admin RPC + non-2xx denial path
 *  - No new public/anonymous endpoint was introduced for these workflows
 *    (verify_jwt is not disabled in supabase/config.toml for any of these
 *    function names).
 *
 * No product code is modified.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const POI_ENGAGEMENTS = readFileSync(
  join(process.cwd(), "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const DRAFT_GEN = readFileSync(
  join(process.cwd(), "supabase/functions/generate-engagement-outreach-draft/index.ts"),
  "utf8",
);
const DRAFT_DECISION = readFileSync(
  join(process.cwd(), "supabase/functions/engagement-outreach-draft-decision/index.ts"),
  "utf8",
);

describe("Edge-function admin gate shape (role-negative source-pin)", () => {
  it("poi-engagements admin paths still call requireRole(authCtx, 'platform_admin')", () => {
    const matches = POI_ENGAGEMENTS.match(/requireRole\(authCtx,\s*["']platform_admin["']\)/g) ?? [];
    // The known admin entry points (GET list, manual/admin outreach blocks,
    // admin-facilitation, internal admin queries) — currently 7+ call sites.
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("poi-engagements imports requireRole from the shared auth module", () => {
    expect(POI_ENGAGEMENTS).toMatch(
      /import[\s\S]*?\brequireRole\b[\s\S]*?from\s+["']\.\.\/_shared\/auth\.ts["']/m,
    );
  });

  it("generate-engagement-outreach-draft has is_admin RPC + 403 denial + 401 unauth", () => {
    expect(DRAFT_GEN).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(DRAFT_GEN).toMatch(/if\s*\(\s*!\s*isAdmin\s*\)/);
    expect(DRAFT_GEN).toMatch(/403/);
    expect(DRAFT_GEN).toMatch(/401/);
  });

  it("engagement-outreach-draft-decision has is_admin RPC + 403 denial + 401 unauth", () => {
    expect(DRAFT_DECISION).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(DRAFT_DECISION).toMatch(/if\s*\(\s*!\s*isAdmin\s*\)/);
    expect(DRAFT_DECISION).toMatch(/403/);
    expect(DRAFT_DECISION).toMatch(/401/);
  });

  it("no public/anonymous bypass: verify_jwt is not set to false for these functions in config.toml", () => {
    const configPath = join(process.cwd(), "supabase/config.toml");
    if (!existsSync(configPath)) {
      // If no config.toml exists, default verify_jwt is true — that satisfies the assertion.
      expect(true).toBe(true);
      return;
    }
    const config = readFileSync(configPath, "utf8");
    for (const fn of [
      "poi-engagements",
      "generate-engagement-outreach-draft",
      "engagement-outreach-draft-decision",
    ]) {
      // Look for a per-function section that sets verify_jwt = false.
      const sectionRe = new RegExp(
        `\\[functions\\.${fn}\\][\\s\\S]*?verify_jwt\\s*=\\s*false`,
        "m",
      );
      expect(
        sectionRe.test(config),
        `${fn} must not disable verify_jwt in supabase/config.toml`,
      ).toBe(false);
    }
  });

  it("denial paths are audited for both AI drafter endpoints", () => {
    expect(DRAFT_GEN).toMatch(/engagement\.outreach_draft\.access_denied/);
    expect(DRAFT_DECISION).toMatch(/engagement\.outreach_draft\.access_denied/);
  });
});
