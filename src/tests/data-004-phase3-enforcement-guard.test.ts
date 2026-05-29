/**
 * DATA-004 Phase 3 — enforcement layer static contract tests.
 *
 * Pin the shape of:
 *   - the canonical retention-job audit names
 *   - the single-consumer enforcement-scope guard
 *   - the fail-closed decision helper
 *   - HQ Retention Health enforcement labelling
 *   - the retention_run_evidence access surface
 *
 * Static (source-level) only — does not hit the running backend.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}
function run(script: string) {
  execFileSync("node", [`scripts/${script}`], { cwd: ROOT, stdio: "pipe" });
}

const SWEEPER = "supabase/functions/purge-email-send-log-daily/index.ts";
const DECISION = "supabase/functions/_shared/retention-decision.ts";
const ADMIN_FN = "supabase/functions/admin-org-retention/index.ts";
const PANEL = "src/components/admin/OrgRetentionHealthPanel.tsx";

describe("DATA-004 Phase 3 — sweeper exists and is the only wired consumer", () => {
  it("purge-email-send-log-daily edge function exists", () => {
    expect(existsSync(resolve(ROOT, SWEEPER))).toBe(true);
  });

  it("canonical retention-job audit names are pinned (prebuild guard)", () => {
    expect(() => run("check-data-004-phase3-audit-names.mjs")).not.toThrow();
  });

  it("single-consumer enforcement scope is enforced (prebuild guard)", () => {
    expect(() => run("check-data-004-phase3-enforcement-scope.mjs")).not.toThrow();
  });

  it("deferred sweepers still cannot consume org_retention_policies", () => {
    expect(() => run("check-data-004-phase2-no-enforcement.mjs")).not.toThrow();
  });
});

describe("DATA-004 Phase 3 — fail-closed decision helper", () => {
  const src = read(DECISION);
  it("exports the canonical decision union", () => {
    for (const k of [
      "eligible_for_purge",
      "retained_not_expired",
      "skipped_due_to_missing_policy",
      "skipped_due_to_disabled_policy",
      "skipped_due_to_invalid_policy",
      "skipped_due_to_legal_hold",
      "skipped_due_to_error",
    ]) {
      expect(src).toContain(`"${k}"`);
    }
  });
  it("treats missing org policy as missing-policy skip (no platform fallback)", () => {
    expect(src).toMatch(/no_explicit_policy_for_org_record_class/);
  });
  it("treats metadata.enabled === false as disabled-policy skip", () => {
    expect(src).toMatch(/metadata\.enabled === false/);
  });
  it("rejects retention_days below the platform floor", () => {
    expect(src).toMatch(/below platform floor/);
  });
  it("checks legal holds before declaring eligibility", () => {
    expect(src).toMatch(/assertNoLegalHold/);
    expect(src).toMatch(/skipped_due_to_legal_hold/);
  });
  it("fails closed on lookup errors (does not authorise deletion)", () => {
    expect(src).toMatch(/policy_lookup_failed/);
    expect(src).toMatch(/legal_hold_lookup_threw/);
  });
  it("does not fall back to get_effective_retention_days (which masks missing as floor)", () => {
    expect(src).not.toMatch(/get_effective_retention_days/);
  });
});

describe("DATA-004 Phase 3 — sweeper safety + auth", () => {
  const src = read(SWEEPER);
  it("requires INTERNAL_CRON_KEY or service-role bearer", () => {
    expect(src).toMatch(/INTERNAL_CRON_KEY/);
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/unauthorized/);
  });
  it("defaults dry_run to TRUE", () => {
    expect(src).toMatch(/dry_run !== false/);
  });
  it("emits per-org skip audits and a summary audit", () => {
    expect(src).toMatch(/RETENTION_JOB_AUDIT_NAMES\.skipped/);
    expect(src).toMatch(/RETENTION_JOB_AUDIT_NAMES\.(completed|partial|failed)/);
  });
  it("writes retention_run_evidence on start and finish", () => {
    expect(src).toMatch(/status:\s*"started"/);
    expect(src.match(/retention_run_evidence/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it("only this sweeper imports the shared retention-decision helper among sweepers", () => {
    // Walk supabase/functions/* and look for imports of retention-decision.
    const fnRoot = resolve(ROOT, "supabase/functions");
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const offenders: string[] = [];
    for (const name of fs.readdirSync(fnRoot)) {
      if (name === "_shared" || name === "purge-email-send-log-daily") continue;
      const dir = path.join(fnRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const walk = (d: string): string[] =>
        fs.readdirSync(d).flatMap((n) => {
          const p = path.join(d, n);
          return fs.statSync(p).isDirectory() ? walk(p) : [p];
        });
      for (const file of walk(dir)) {
        if (!/\.(ts|js)$/.test(file)) continue;
        if (fs.readFileSync(file, "utf8").includes("retention-decision")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("DATA-004 Phase 3 — HQ Retention Health labels email_send_log as enforced", () => {
  const panel = read(PANEL);
  it("panel no longer claims full shell-only enforcement", () => {
    expect(panel).toMatch(/email_send_log/);
    expect(panel).toMatch(/enforced/i);
  });
  it("admin-org-retention health surfaces enforcement metadata", () => {
    const adminFn = read(ADMIN_FN);
    expect(adminFn).toMatch(/email_send_log/);
  });
});

describe("DATA-004 Phase 3 — admin-org-retention AAL2 contract unchanged", () => {
  const src = read(ADMIN_FN);
  it("set/clear still gate on AAL2, list/health still skip AAL2", () => {
    expect(src).toMatch(
      /parsed\.data\.action === "set" \|\| parsed\.data\.action === "clear"/,
    );
    const callsites = src.match(/assertAal2\(/g) ?? [];
    expect(callsites.length).toBe(1);
  });
  it("canonical policy audit names unchanged", () => {
    expect(src).toMatch(/data\.org_retention_policy\.set/);
    expect(src).toMatch(/data\.org_retention_policy\.cleared/);
  });
});
