/**
 * DATA-004 Batch 20 — Email Anonymisation Readiness Assessment.
 *
 * Static contract tests. The probe is assessment-only and must not
 * acquire any live anonymisation behaviour without an explicit future
 * batch. These tests mirror scripts/check-email-anonymisation-readiness-contract.mjs
 * and add probe-shape assertions vitest can express more readably.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const PROBE_PATH = resolve(
  ROOT,
  "supabase/functions/email-anonymisation-readiness-probe/index.ts",
);
const SRC = readFileSync(PROBE_PATH, "utf8");

/** Mirrors the prebuild guard: strip comments + string literals so
 *  documentation/recommendation text cannot trigger forbidden-pattern
 *  checks. We assert against executable code only. */
function stripCommentsAndStrings(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}
const CODE = stripCommentsAndStrings(SRC);


function run(script: string) {
  execFileSync("node", [`scripts/${script}`], { cwd: ROOT, stdio: "pipe" });
}

describe("DATA-004 Batch 20 — probe gating", () => {
  it("requires platform_admin role", () => {
    expect(SRC).toMatch(/has_role[\s\S]*?_role:\s*"platform_admin"/);
  });

  it("requires AAL2 / MFA", () => {
    expect(SRC).toMatch(/assertAal2\(/);
    expect(SRC).toMatch(/MFA_REQUIRED/);
  });

  it("short-circuits on legal hold against email_send_log_anonymise record group", () => {
    expect(SRC).toMatch(/assertNoLegalHold\(/);
    expect(SRC).toMatch(/RECORD_GROUP_IDS\.email_send_log_anonymise/);
    expect(SRC).toMatch(/legal_hold_active:\s*true/);
  });
});

describe("DATA-004 Batch 20 — probe is schema-level only, never row-level", () => {
  it("does NOT call .from('email_send_log')", () => {
    expect(SRC).not.toMatch(/\.from\(\s*["']email_send_log["']\s*\)/);
  });

  it("does NOT invoke the anonymise RPC", () => {
    expect(CODE).not.toMatch(/\.rpc\(\s*["']anonymise_old_email_send_log["']/);
  });

  it("does NOT contain SELECT/UPDATE/DELETE/INSERT/UPSERT/TRUNCATE/ALTER against email_send_log", () => {
    const banned = [
      /select\b[^;]*\bfrom\s+(public\.)?email_send_log\b/i,
      /update\s+(public\.)?email_send_log\b/i,
      /delete\s+from\s+(public\.)?email_send_log\b/i,
      /insert\s+into\s+(public\.)?email_send_log\b/i,
      /upsert\s+(public\.)?email_send_log\b/i,
      /truncate\s+(public\.)?email_send_log\b/i,
      /alter\s+table\s+(public\.)?email_send_log\b/i,
    ];
    for (const re of banned) expect(CODE).not.toMatch(re);
  });
});


describe("DATA-004 Batch 20 — readiness response shape", () => {
  it("response is marked assessment_only", () => {
    expect(SRC).toMatch(/assessment_only:\s*true/);
  });

  it("declares no live anonymisation path", () => {
    expect(SRC).toMatch(/live_anonymisation_path_present:\s*false/);
    expect(SRC).toMatch(/scheduled_anonymisation_job:\s*false/);
  });

  it("includes the schema inventory with disposition vocabulary", () => {
    expect(SRC).toMatch(/EMAIL_SEND_LOG_SCHEMA_INVENTORY/);
    expect(SRC).toMatch(/disposition:\s*"keep"/);
    expect(SRC).toMatch(/disposition:\s*"truncate"/);
    expect(SRC).toMatch(/disposition:\s*"null"/);
    expect(SRC).toMatch(/disposition:\s*"aggregate_only"/);
  });

  it("includes a readiness verdict with stable shape", () => {
    expect(SRC).toMatch(/READINESS_VERDICT/);
    expect(SRC).toMatch(/verdict:\s*"needed_only_if_long_horizon_analytics_required"/);
    expect(SRC).toMatch(/rationale:/);
    expect(SRC).toMatch(/recommendation_if_pursued:/);
    expect(SRC).toMatch(/not_pursuing_because:/);
  });

  it("does not return PII columns keyed from a row", () => {
    const piiCols = ["recipient_email", "error_message", "metadata", "message_id"];
    for (const col of piiCols) {
      const piiReturn = new RegExp(`${col}\\s*:\\s*[a-zA-Z_][a-zA-Z0-9_]*\\.${col}`);
      expect(SRC).not.toMatch(piiReturn);
    }
  });
});

describe("DATA-004 Batch 20 — canonical audit", () => {
  it("pins the canonical audit name", () => {
    expect(SRC).toMatch(/READINESS_AUDIT_NAME\s*=\s*"data\.email_anonymisation_readiness_probed"/);
  });

  it("writes the canonical audit to audit_logs", () => {
    expect(SRC).toMatch(/from\("audit_logs"\)\.insert/);
  });
});

describe("DATA-004 Batch 20 — no new cron schedule", () => {
  it("no migration in the tree schedules the readiness probe", () => {
    const migrationsDir = resolve(ROOT, "supabase/migrations");
    if (!existsSync(migrationsDir)) return;
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(d)) {
        const full = join(d, e);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".sql")) out.push(full);
      }
      return out;
    };
    for (const f of walk(migrationsDir)) {
      const sql = readFileSync(f, "utf8");
      expect(sql).not.toMatch(/cron\.schedule\([^)]*email-anonymisation-readiness-probe/i);
    }
  });
});

describe("DATA-004 Batch 20 — contract guard parity", () => {
  it("scripts/check-email-anonymisation-readiness-contract.mjs passes", () => {
    expect(() => run("check-email-anonymisation-readiness-contract.mjs")).not.toThrow();
  });
});
