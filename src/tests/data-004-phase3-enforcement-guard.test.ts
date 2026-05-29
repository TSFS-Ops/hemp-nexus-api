/**
 * DATA-004 Phase 3 (+ Phase 3.1) — enforcement-layer static contract tests.
 *
 * Pin the shape of:
 *   - the canonical retention-job audit names + persistence map
 *   - the single-consumer enforcement-scope guard
 *   - the fail-closed decision helper
 *   - HQ Retention Health enforcement labelling
 *   - the retention_run_evidence access surface
 *   - Phase 3.1 candidate-discovery + audit-failure visibility contract
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

  it("canonical retention-job audit names + persistence map are pinned (prebuild guard)", () => {
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
  it("writes retention_run_evidence on start, per-org, and finish", () => {
    expect(src).toMatch(/status:\s*"started"/);
    expect(src.match(/retention_run_evidence/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("DATA-004 Phase 3.1 — evidence hardening", () => {
  const src = read(SWEEPER);

  it("enumerates orgs from candidate email_send_log rows (not only policy table)", () => {
    expect(src).toMatch(/discover_email_send_log_candidate_orgs/);
  });

  it("missing-policy orgs are bucketed under rows_skipped_missing_policy", () => {
    // bumpForDecision must wire 'skipped_due_to_missing_policy' to the counter
    expect(src).toMatch(/skipped_due_to_missing_policy/);
    expect(src).toMatch(/rows_skipped_missing_policy/);
  });

  it("lifecycle events are classified evidence_only (not audit_logs writes)", () => {
    expect(src).toMatch(/RETENTION_JOB_AUDIT_PERSISTENCE/);
    expect(src).toMatch(/started:\s*"evidence_only"/);
    expect(src).toMatch(/completed:\s*"evidence_only"/);
    expect(src).toMatch(/partial:\s*"evidence_only"/);
    expect(src).toMatch(/failed:\s*"evidence_only"/);
    expect(src).toMatch(/skipped:\s*"audit_logs_per_org"/);
  });

  it("does not attempt run-level audit_logs writes with null org_id", () => {
    // Phase 3.1 removed the lifecycle audit writer. The sweeper must NOT
    // call any helper that inserts a run-level audit row with null org_id.
    expect(src).not.toMatch(/writeAudit\(/);
    expect(src).toMatch(/lifecycle_persistence:\s*"evidence_only"/);
  });

  it("per-org skipped audits persist to audit_logs with real org_id", () => {
    expect(src).toMatch(/writePerOrgSkipAudit/);
    expect(src).toMatch(/action:\s*RETENTION_JOB_AUDIT_NAMES\.skipped/);
  });

  it("audit/evidence write failures are tracked and surfaced (never swallowed)", () => {
    expect(src).toMatch(/auditWriteFailures/);
    expect(src).toMatch(/evidenceWriteFailures/);
    // surfaced in response
    expect(src).toMatch(/audit_write_failures/);
    expect(src).toMatch(/evidence_write_failures/);
    // surfaced inline in evidence on per-org audit failure
    expect(src).toMatch(/audit_write_failed/);
  });

  it("response payload includes per-org decisions for operator inspection", () => {
    expect(src).toMatch(/per_org:/);
  });
});

describe("DATA-004 Phase 3 — HQ Retention Health labels email_send_log as enforced", () => {
  const panel = read(PANEL);
  it("panel renders email_send_log enforcement banner", () => {
    expect(panel).toMatch(/email_send_log/);
    expect(panel).toMatch(/enforced/i);
  });
  it("panel exposes Phase 3.1 lifecycle-vs-audit distinction", () => {
    expect(panel).toMatch(/retention_run_evidence/);
    expect(panel).toMatch(/audit_logs/);
    expect(panel).toMatch(/pg_cron is NOT scheduled/);
  });
  it("panel surfaces missing-policy / legal-hold skip counters", () => {
    expect(panel).toMatch(/Missing-policy skips/);
    expect(panel).toMatch(/Legal-hold skips/);
  });
  it("panel surfaces audit-write-failure warning when present", () => {
    expect(panel).toMatch(/audit_write_failures/);
  });
  it("admin-org-retention health surfaces last_run_email_send_log", () => {
    const adminFn = read(ADMIN_FN);
    expect(adminFn).toMatch(/last_run_email_send_log/);
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
