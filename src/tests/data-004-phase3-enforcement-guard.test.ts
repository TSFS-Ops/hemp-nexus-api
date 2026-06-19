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
    expect(panel).toMatch(/live purge is NOT scheduled/i);
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

describe("DATA-004 Phase 3.2 / Phase 4 — scheduled dry-run only (live purge NOT scheduled)", () => {
  it("scheduling guard exists and passes (prebuild)", () => {
    expect(
      existsSync(resolve(ROOT, "scripts/check-data-004-phase3-2-no-schedule.mjs")),
    ).toBe(true);
    expect(() => run("check-data-004-phase3-2-no-schedule.mjs")).not.toThrow();
  });

  it("any migration that schedules the sweeper must pin dry_run=true and never dry_run=false", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const migDir = resolve(ROOT, "supabase/migrations");
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return fs.statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith(".sql") ? [p] : [];
      });
    };
    const strip = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => {
          const i = l.indexOf("--");
          return i === -1 ? l : l.slice(0, i);
        })
        .join("\n");
    for (const file of walk(migDir)) {
      const code = strip(fs.readFileSync(file, "utf8"));
      if (!code.includes("purge-email-send-log-daily")) continue;
      const schedules =
        /cron\.schedule\s*\([^)]*purge-email-send-log-daily/.test(code) ||
        /net\.http_post[\s\S]*purge-email-send-log-daily/.test(code);
      if (!schedules) continue;
      const pinsTrue = /['"]dry_run['"]\s*[:,]\s*true\b/i.test(code);
      const pinsFalse = /['"]dry_run['"]\s*[:,]\s*false\b/i.test(code);
      expect(
        pinsTrue,
        `${file} schedules sweeper without pinning dry_run=true`,
      ).toBe(true);
      expect(
        pinsFalse,
        `${file} pins dry_run=false — forbidden in Phase 4`,
      ).toBe(false);
    }
  });

  it("admin-org-retention health response advertises Phase 4 scheduling state", () => {
    const src = read(ADMIN_FN);
    expect(src).toMatch(/scheduling_status/);
    expect(src).toMatch(/phase_4_scheduled_dry_run_active_live_purge_pending_approval/);
    expect(src).toMatch(/phase_4_unexpected_live_schedule_present/);
    expect(src).toMatch(/dry_run_default:\s*true/);
    expect(src).toMatch(/rollback_sql/);
    expect(src).toMatch(/get_purge_email_send_log_cron_jobs/);
  });

  it("HQ Retention Health panel surfaces 'live purge is NOT scheduled' + scheduled dry-run state", () => {
    const panel = read(PANEL);
    expect(panel).toMatch(/scheduled dry-run/i);
    expect(panel).toMatch(/live purge is NOT scheduled/i);
    expect(panel).toMatch(/scheduling_status/);
    expect(panel).toMatch(/cron\.unschedule/);
    expect(panel).toMatch(/LIVE_UNEXPECTED/);
  });

  it("RELEASE_GATE.md carries Phase 3.2 + Phase 4 sections", () => {
    const rg = read("RELEASE_GATE.md");
    expect(rg).toMatch(/DATA-004 Phase 3\.2/);
    expect(rg).toMatch(/DATA-004 Phase 4/);
    expect(rg).toMatch(/scheduling readiness/i);
    expect(rg).toMatch(/scheduled dry-run/i);
    expect(rg).toMatch(/live purge is NOT scheduled/i);
    expect(rg).toMatch(/Explicit human approval/i);
    expect(rg).toMatch(/separate.*approval/i);
  });

  it("docs/launch-runbook.md carries Phase 4 schedule + rollback", () => {
    const rb = read("docs/launch-runbook.md");
    expect(rb).toMatch(/DATA-004 Phase 3\.2/);
    expect(rb).toMatch(/DATA-004 Phase 4/);
    expect(rb).toMatch(/scheduling readiness/i);
    expect(rb).toMatch(/live purge is NOT scheduled/i);
    expect(rb).toMatch(/scheduled dry-run/i);
    expect(rb).toMatch(/separate approval/i);
    expect(rb).toMatch(/rollback/i);
    expect(rb).toMatch(/cron\.unschedule\('purge-email-send-log-daily-dryrun'\)/);
  });
});

describe("DATA-004 Batch 7 — cold-storage-archive dry-run-only evidence path", () => {
  const COLD = "supabase/functions/cold-storage-archive/index.ts";
  const GUARD = "scripts/check-data-004-batch7-cold-storage.mjs";
  const stripComments = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => {
        const i = l.indexOf("//");
        return i === -1 ? l : l.slice(0, i);
      })
      .join("\n");

  it("Batch 7 guard exists and passes (prebuild)", () => {
    expect(existsSync(resolve(ROOT, GUARD))).toBe(true);
    expect(() => run("check-data-004-batch7-cold-storage.mjs")).not.toThrow();
  });

  it("cold-storage-archive defaults dry_run to TRUE", () => {
    expect(read(COLD)).toMatch(/body\.dry_run\s*!==\s*false/);
  });

  it("candidate discovery routes through discover_cold_storage_archive_candidates", () => {
    expect(read(COLD)).toMatch(/discover_cold_storage_archive_candidates/);
  });

  it("writes retention_run_evidence on lifecycle events (evidence-only persistence)", () => {
    const src = read(COLD);
    expect(src).toMatch(/retention_run_evidence/);
    expect(src).toMatch(/started:\s*"evidence_only"/);
    expect(src).toMatch(/completed:\s*"evidence_only"/);
    expect(src).toMatch(/partial:\s*"evidence_only"/);
    expect(src).toMatch(/failed:\s*"evidence_only"/);
  });

  it("surfaces the five explicit skip categories", () => {
    const src = read(COLD);
    for (const tok of [
      "skipped_due_to_legal_hold",
      "skipped_due_to_duplicate",
      "skipped_due_to_missing_source",
      "skipped_due_to_bucket_write",
      "skipped_due_to_lookup_error",
    ]) {
      expect(src).toContain(tok);
    }
  });

  it("surfaces audit + evidence write failure arrays (never swallowed)", () => {
    const src = read(COLD);
    expect(src).toMatch(/audit_write_failures/);
    expect(src).toMatch(/evidence_write_failures/);
  });

  it("never deletes source records", () => {
    expect(stripComments(read(COLD))).not.toMatch(/\.delete\s*\(/);
  });

  it("does not consume per-org retention policy (Phase 3 single-consumer rule preserved)", () => {
    const src = stripComments(read(COLD));
    expect(src).not.toMatch(/org_retention_policies/);
    expect(src).not.toMatch(/get_effective_retention_days/);
  });

  it("only the canonical Batch-19 cold-storage-archive cron schedules are present (dryrun + live)", () => {
    // DATA-004 Batch 21 stale re-pin (2026-06-19):
    //   Previous stale Batch-7-era pin asserted that NO migration may
    //   schedule cold-storage-archive via pg_cron at all
    //   (`cron.schedule(... cold-storage-archive ...)` was forbidden
    //   outright). That assumption was superseded by the accepted
    //   DATA-004 Batch 19 / Final Enterprise Status Pack cron posture,
    //   which makes exactly two cold-storage-archive jobnames canonical:
    //     - cold-storage-archive-dryrun  (jobid 40, active, non-destructive)
    //     - cold-storage-archive-live    (jobid 41, non-destructive archival)
    //   Re-pinned here as an allow-list against the canonical migration
    //   files; any other cold-storage-archive* jobname (e.g. the legacy
    //   'cold-storage-archive-weekly') remains forbidden. No migration
    //   or cron entry is modified by this re-pin.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const migDir = resolve(ROOT, "supabase/migrations");
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return fs.statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith(".sql") ? [p] : [];
      });
    };
    const strip = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => {
          const i = l.indexOf("--");
          return i === -1 ? l : l.slice(0, i);
        })
        .join("\n");

    const ALLOWED = new Set([
      "cold-storage-archive-dryrun",
      "cold-storage-archive-live",
    ]);
    const CANONICAL_FILES: Record<string, string> = {
      "cold-storage-archive-dryrun":
        "supabase/migrations/20260529194355_a2e79a7b-207a-410e-adf0-304a00c3e69a.sql",
      "cold-storage-archive-live":
        "supabase/migrations/20260530053747_1f35242b-8074-459c-9c57-fbf6fb953793.sql",
    };

    const scheduleRe =
      /cron\.schedule\s*\(\s*['"](cold-storage-archive[A-Za-z0-9_-]*)['"]/g;
    // Note: net.http_post URLs reference the edge-function name
    // ('cold-storage-archive'), not the cron jobname, so they are not a
    // reliable source of jobnames; only cron.schedule(...) calls are
    // pinned here.

    const seen: Record<string, Set<string>> = {};
    for (const file of walk(migDir)) {
      const code = strip(fs.readFileSync(file, "utf8"));
      if (!code.includes("cold-storage-archive")) continue;
      const names = new Set<string>();
      for (const m of code.matchAll(scheduleRe)) names.add(m[1]);
      for (const m of code.matchAll(httpRe)) names.add(m[1]);
      for (const n of names) {
        expect(
          ALLOWED.has(n),
          `${file} schedules forbidden cold-storage-archive jobname '${n}' (only 'cold-storage-archive-dryrun' and 'cold-storage-archive-live' are allowed under Batch 19 posture)`,
        ).toBe(true);
        (seen[n] ??= new Set<string>()).add(file);
      }
    }

    // Each allowed jobname must be scheduled by its canonical migration.
    for (const [name, canonical] of Object.entries(CANONICAL_FILES)) {
      expect(
        seen[name] && [...seen[name]].some((f) => f.endsWith(path.basename(canonical))),
        `expected canonical migration ${canonical} to schedule '${name}'`,
      ).toBe(true);
    }
  });

  it("other deferred destructive sweepers remain unscheduled", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const migDir = resolve(ROOT, "supabase/migrations");
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return fs.statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith(".sql") ? [p] : [];
      });
    };
    const strip = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => {
          const i = l.indexOf("--");
          return i === -1 ? l : l.slice(0, i);
        })
        .join("\n");
    for (const name of [
      "storage-retention-cleanup",
      "account-deletion-sweeper",
      "email-log-anonymise",
    ]) {
      for (const file of walk(migDir)) {
        const code = strip(fs.readFileSync(file, "utf8"));
        if (!code.includes(name)) continue;
        expect(
          new RegExp(`cron\\.schedule\\s*\\([^)]*${name}`).test(code),
          `${file} schedules deferred sweeper '${name}' — forbidden in Batch 7`,
        ).toBe(false);
        expect(
          new RegExp(`net\\.http_post[\\s\\S]*${name}`).test(code),
          `${file} schedules deferred sweeper '${name}' — forbidden in Batch 7`,
        ).toBe(false);
      }
    }
  });

  it("RELEASE_GATE.md carries the DATA-004 Batch 7 cold-storage section", () => {
    const rg = read("RELEASE_GATE.md");
    expect(rg).toMatch(/DATA-004 Batch 7/);
    expect(rg).toMatch(/cold-storage-archive/);
    expect(rg).toMatch(/dry-run-only/i);
    expect(rg).toMatch(/cold-storage-archive[^.]*NOT scheduled/i);
    expect(rg).toMatch(/separate,?\s+second\s+approval/i);
  });

  it("docs/launch-runbook.md carries the DATA-004 Batch 7 cold-storage section", () => {
    const rb = read("docs/launch-runbook.md");
    expect(rb).toMatch(/DATA-004 Batch 7/);
    expect(rb).toMatch(/cold-storage-archive/);
    expect(rb).toMatch(/dry-run-only/i);
    expect(rb).toMatch(/cold-storage-archive[^.]*NOT scheduled/i);
    expect(rb).toMatch(/manual_dry_run_only/);
  });
});




