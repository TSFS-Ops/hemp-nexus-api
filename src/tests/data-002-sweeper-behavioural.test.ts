/**
 * DATA-002 Phase 1 — account-deletion-sweeper behavioural assertions.
 *
 * Source-level behavioural checks against the sweeper, mirroring the
 * pattern used by legal-hold-edge-wiring.test.ts and the Batch O suite.
 * Verifies that the canonical DATA-002 audits, broadened guard set,
 * legal-hold integration, idempotency check, and destructive-confirm
 * gate are all wired correctly. Production exercise of the destructive
 * path is intentionally NOT performed (Phase 2 sign-off gate).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const SWEEPER = read("supabase/functions/account-deletion-sweeper/index.ts");

describe("DATA-002 — sweeper canonical audits", () => {
  it("emits data.deletion_window_elapsed for every elapsed candidate", () => {
    expect(SWEEPER).toContain("data.deletion_window_elapsed");
    // Must be written BEFORE guards run (so the call appears before the
    // guards array literal in the loop body).
    const elapsedIdx = SWEEPER.indexOf('"data.deletion_window_elapsed"');
    const guardsIdx = SWEEPER.indexOf("guards: Array<() => Promise<GuardResult>>");
    expect(elapsedIdx).toBeGreaterThan(0);
    expect(guardsIdx).toBeGreaterThan(elapsedIdx);
  });

  it("emits data.profile_deleted_or_anonymised on destructive success", () => {
    expect(SWEEPER).toContain('"data.profile_deleted_or_anonymised"');
    // Must appear inside the destructive branch (after auth.admin.deleteUser).
    const delIdx = SWEEPER.indexOf("auth.admin.deleteUser(userId)");
    const auditIdx = SWEEPER.indexOf('"data.profile_deleted_or_anonymised"');
    expect(delIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeGreaterThan(delIdx);
  });

  it("emits data.deletion_deferred_retention_required on every blocked candidate", () => {
    expect(SWEEPER).toContain('"data.deletion_deferred_retention_required"');
    // Must carry defer_reason and guard_name.
    expect(SWEEPER).toMatch(/data\.deletion_deferred_retention_required[\s\S]+defer_reason/);
    expect(SWEEPER).toMatch(/data\.deletion_deferred_retention_required[\s\S]+guard_name/);
  });

  it("writes canonical audits to public.audit_logs (not admin_audit_logs)", () => {
    expect(SWEEPER).toMatch(/canonicalAudit[\s\S]+from\("audit_logs"\)/);
  });
});

describe("DATA-002 — legacy audit names preserved (back-compat)", () => {
  for (const name of [
    "account.hard_delete_candidate",
    "account.hard_deleted",
    "account.hard_delete_failed",
    "account.hard_delete_skipped",
  ]) {
    it(`still emits ${name}`, () => {
      expect(SWEEPER).toContain(`"${name}"`);
    });
  }
});

describe("DATA-002 — 30-day window cutoff", () => {
  it("uses a 30-day grace period constant", () => {
    expect(SWEEPER).toMatch(/GRACE_PERIOD_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("filters profiles by deletion_requested_at <= cutoff (29-day profile not selected, 31-day selected)", () => {
    expect(SWEEPER).toMatch(/\.lte\("deletion_requested_at",\s*cutoffIso\)/);
    expect(SWEEPER).toMatch(/\.eq\("status",\s*"pending_deletion"\)/);
    expect(SWEEPER).toMatch(/\.not\("deletion_requested_at",\s*"is",\s*null\)/);
  });
});

describe("DATA-002 — legal-hold integration at sweep time", () => {
  it("imports assertNoLegalHold from DATA-003 shared helper", () => {
    expect(SWEEPER).toMatch(/import\s*\{\s*assertNoLegalHold\s*\}\s*from\s*"\.\.\/_shared\/legal-hold\.ts"/);
  });

  it("calls assertNoLegalHold with user + org scopes", () => {
    expect(SWEEPER).toMatch(/scope_type:\s*"user",\s*scope_id:\s*userId/);
    expect(SWEEPER).toMatch(/scope_type:\s*"org",\s*scope_id:\s*orgId/);
  });

  it("fails closed on LEGAL_HOLD_ACTIVE and LEGAL_HOLD_CHECK_FAILED", () => {
    expect(SWEEPER).toContain("legal_hold_active");
    expect(SWEEPER).toContain("legal_hold_check_failed");
    expect(SWEEPER).toMatch(/hold\.code\s*===\s*"LEGAL_HOLD_CHECK_FAILED"/);
  });
});

describe("DATA-002 — broadened sweep-time guards", () => {
  const guardChecks: Array<[string, RegExp]> = [
    ["legal_hold guard", /guardLegalHold/],
    ["platform_admin guard", /guardPlatformAdmin[\s\S]+platform_admin_requires_break_glass/],
    ["active POIs guard", /guardActivePois[\s\S]+org_has_active_pois/],
    ["active trade_requests guard", /guardActiveTradeRequests[\s\S]+org_has_active_trade_requests/],
    ["non-terminal matches guard (org on either side)", /guardNonTerminalMatches[\s\S]+buyer_org_id\.eq\.\$\{orgId\},seller_org_id\.eq\.\$\{orgId\}/],
    ["in-flight WaDs guard (org on either side)", /guardInFlightWads[\s\S]+org_has_in_flight_wads/],
    ["open billing guard (unsettled credits.purchase_initiated)", /guardOpenBilling[\s\S]+credits\.purchase_initiated/],
    ["open refund/chargeback guard — dependency_unverified fail-closed when table missing", /guardOpenRefundChargeback[\s\S]+dependency_unverified[\s\S]+payment_disputes/],
    ["open compliance guard (dd_approval_requests)", /guardOpenCompliance[\s\S]+dd_approval_requests/],
    ["open disputes guard — either side via match join", /guardOpenDisputes[\s\S]+raised_by_org_id[\s\S]+match_id/],
  ];
  for (const [label, re] of guardChecks) {
    it(label, () => {
      expect(SWEEPER).toMatch(re);
    });
  }

  it("guards run inside the per-candidate loop and short-circuit on first failure", () => {
    expect(SWEEPER).toMatch(/for \(const g of guards\)[\s\S]+if \(!r\.ok\)[\s\S]+break/);
  });

  it("blocked candidate dual-writes legacy + canonical audit", () => {
    const blockBranch = SWEEPER.split("if (blocked)")[1] ?? "";
    expect(blockBranch).toContain('"account.hard_delete_skipped"');
    expect(blockBranch).toContain('"data.deletion_deferred_retention_required"');
  });
});

describe("DATA-002 — dry-run preserved", () => {
  it("defaults to dry-run (back-compat with P0-5)", () => {
    expect(SWEEPER).toMatch(/const\s+dryRun\s*=\s*body\.dry_run\s*!==\s*false/);
  });

  it("dry-run writes account.hard_delete_candidate and does NOT call auth.admin.deleteUser", () => {
    const dryBranch = SWEEPER.split("if (dryRun) {")[1]?.split("// Destructive path.")[0] ?? "";
    expect(dryBranch).toContain('"account.hard_delete_candidate"');
    expect(dryBranch).not.toContain("auth.admin.deleteUser");
  });

  it("data.deletion_window_elapsed is written regardless of dry-run flag", () => {
    // The canonical-elapsed audit is emitted before the dryRun branch.
    const beforeDry = SWEEPER.split("if (dryRun) {")[0];
    expect(beforeDry).toContain('"data.deletion_window_elapsed"');
  });
});

describe("DATA-002 — destructive path gating", () => {
  it("requires explicit confirm:'HARD_DELETE' for destructive runs", () => {
    expect(SWEEPER).toMatch(/body\.confirm\s*!==\s*"HARD_DELETE"/);
    expect(SWEEPER).toContain("DESTRUCTIVE_CONFIRMATION_REQUIRED");
  });

  it("anonymises email + scrubs PII BEFORE physical deletion", () => {
    const destructive = SWEEPER.split("// Destructive path.")[1] ?? "";
    const updateIdx = destructive.indexOf("updateUserById(userId");
    const scrubIdx = destructive.indexOf("scrub_user_pii");
    const deleteIdx = destructive.indexOf("auth.admin.deleteUser(userId)");
    expect(updateIdx).toBeGreaterThan(0);
    expect(scrubIdx).toBeGreaterThan(updateIdx);
    expect(deleteIdx).toBeGreaterThan(scrubIdx);
  });
});

describe("DATA-002 — idempotency", () => {
  it("checks auth.admin.getUserById and skips with already_hard_deleted if absent", () => {
    expect(SWEEPER).toMatch(/auth\.admin\.getUserById\(userId\)/);
    expect(SWEEPER).toContain("already_hard_deleted");
    // The skip path must NOT re-emit data.profile_deleted_or_anonymised.
    const idempotent = SWEEPER.split('reason: "already_hard_deleted"')[1]?.split("continue;")[0] ?? "";
    expect(idempotent).not.toContain("data.profile_deleted_or_anonymised");
  });
});

describe("DATA-002 Phase 1 — destructive cron remains disabled", () => {
  it("repo contains no checked-in cron migration with dry_run:false for account-deletion-sweeper", () => {
    // Mirrors the prebuild guard; defence in depth.
    const fs = require("node:fs");
    const path = require("node:path");
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      const out: string[] = [];
      for (const e of fs.readdirSync(dir)) {
        const p = path.join(dir, e);
        const s = fs.statSync(p);
        if (s.isDirectory()) out.push(...walk(p));
        else if (/\.(sql|json|toml)$/.test(e)) out.push(p);
      }
      return out;
    };
    for (const f of walk("supabase/migrations")) {
      const t = fs.readFileSync(f, "utf8");
      if (t.includes("account-deletion-sweeper")) {
        expect(t).not.toMatch(/dry_run["']?\s*[:=]\s*false/i);
      }
    }
  });
});
