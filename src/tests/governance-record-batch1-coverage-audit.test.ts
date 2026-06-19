/**
 * Governance Record Batch 1 — Critical-Event Coverage Audit (assessment-only).
 *
 * Static contract tests. The probe must not acquire any runtime
 * enforcement behaviour, must never read event_store rows, and must
 * emit exactly one canonical audit name. These tests mirror
 * scripts/check-governance-record-coverage-contract.mjs and add
 * probe-shape assertions vitest can express more readably.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const PROBE_PATH = resolve(
  ROOT,
  "supabase/functions/governance-record-coverage-probe/index.ts",
);
const SRC = readFileSync(PROBE_PATH, "utf8");

/** Mirrors the prebuild guard: strip comments + string literals so
 *  documentation/evidence text cannot trigger forbidden-pattern checks. */
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

describe("Governance Record Batch 1 — probe gating", () => {
  it("requires platform_admin role", () => {
    expect(SRC).toMatch(/has_role[\s\S]*?_role:\s*"platform_admin"/);
  });

  it("requires AAL2 / MFA", () => {
    expect(SRC).toMatch(/assertAal2\(/);
    expect(SRC).toMatch(/MFA_REQUIRED/);
  });

  it("registers governance.event_store.coverage_probe as AAL2 in aal-preflight", () => {
    const registry = readFileSync(
      resolve(ROOT, "supabase/functions/aal-preflight/index.ts"),
      "utf8",
    );
    expect(registry).toMatch(
      /"governance\.event_store\.coverage_probe"\s*:\s*"aal2"/,
    );
  });
});

describe("Governance Record Batch 1 — probe is assessment-only", () => {
  it("does NOT call .from('event_store')", () => {
    expect(CODE).not.toMatch(/\.from\(\s*["']event_store["']\s*\)/);
  });

  it("does NOT contain SELECT/UPDATE/DELETE/INSERT/UPSERT/TRUNCATE/ALTER against event_store", () => {
    const banned = [
      /select\b[^;]*\bfrom\s+(public\.)?event_store\b/i,
      /update\s+(public\.)?event_store\b/i,
      /delete\s+from\s+(public\.)?event_store\b/i,
      /insert\s+into\s+(public\.)?event_store\b/i,
      /upsert\s+(public\.)?event_store\b/i,
      /truncate\s+(public\.)?event_store\b/i,
      /alter\s+table\s+(public\.)?event_store\b/i,
    ];
    for (const re of banned) expect(CODE).not.toMatch(re);
  });

  it("does NOT import any critical-event writer", () => {
    for (const w of [
      "writeCriticalGovernanceEvent",
      "writeGovernanceEventBestEffort",
      "writeCriticalEventWithPosture",
    ]) {
      expect(CODE).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
  });

  it("does NOT introspect information_schema / pg_catalog at runtime", () => {
    expect(CODE).not.toMatch(/information_schema\.|pg_catalog\./i);
  });
});

describe("Governance Record Batch 1 — response shape", () => {
  it("response is marked assessment_only and non-mutating", () => {
    expect(SRC).toMatch(/assessment_only:\s*true/);
    expect(SRC).toMatch(/reads_event_store_rows:\s*false/);
    expect(SRC).toMatch(/mutates_event_store:\s*false/);
    expect(SRC).toMatch(/adds_fail_closed_enforcement:\s*false/);
  });

  it("exposes a static coverage matrix with stable status vocabulary", () => {
    expect(SRC).toMatch(/COVERAGE_MATRIX/);
    for (const status of [
      '"wired"',
      '"partial"',
      '"audit_logs_only"',
      '"unwired"',
      '"unknown_needs_manual_review"',
    ]) {
      expect(SRC).toContain(status);
    }
  });

  it("matrix entries declare canonical_event_type, status, and evidence", () => {
    expect(SRC).toMatch(/canonical_event_type:/);
    expect(SRC).toMatch(/status:/);
    expect(SRC).toMatch(/evidence:/);
    expect(SRC).toMatch(/recommended_next_action:/);
  });

  it("response summary exposes fail_closed_blockers (unwired/audit_logs_only/unknown)", () => {
    expect(SRC).toMatch(/fail_closed_blockers/);
  });

  it("does not return raw event_store payload contents", () => {
    // No keyed-from-row PII-style return shape.
    expect(SRC).not.toMatch(/payload\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*\.payload/);
    expect(SRC).not.toMatch(/aggregate_id\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*\.aggregate_id/);
  });
});

describe("Governance Record Batch 1 — canonical audit", () => {
  it("pins the canonical audit name (one and only one new name)", () => {
    expect(SRC).toMatch(
      /COVERAGE_AUDIT_NAME\s*=\s*"governance\.event_store\.coverage_probed"/,
    );
  });

  it("writes the canonical audit to audit_logs", () => {
    expect(SRC).toMatch(/from\("audit_logs"\)\.insert/);
  });

  it("does not introduce any other governance.event_store.* audit name", () => {
    // Two legitimate identifiers exist in the probe:
    //   - canonical audit name           : "governance.event_store.coverage_probed"
    //   - AAL2 action key (aal-preflight): "governance.event_store.coverage_probe"
    // Any third governance.event_store.* literal would be drift.
    const matches = SRC.match(/"governance\.event_store\.[a-z_.]+"/g) ?? [];
    const unique = Array.from(new Set(matches)).sort();
    expect(unique).toEqual([
      '"governance.event_store.coverage_probe"',
      '"governance.event_store.coverage_probed"',
    ]);
  });
});

describe("Governance Record Batch 1 — no UI surface", () => {
  it("no Coverage panel / probe UI component under src/components/admin/governance", () => {
    const dir = resolve(ROOT, "src/components/admin/governance");
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      expect(/^CoveragePanel/i.test(f)).toBe(false);
      expect(/CoverageProbe/i.test(f)).toBe(false);
    }
  });

  it("no client-side (non-test) src/ file references the probe", () => {
    const walk = (d: string, out: string[] = []): string[] => {
      if (!existsSync(d)) return out;
      for (const e of readdirSync(d)) {
        const full = join(d, e);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|js|jsx)$/.test(full)) out.push(full);
      }
      return out;
    };
    for (const f of walk(resolve(ROOT, "src"))) {
      if (/\.test\.(ts|tsx)$/.test(f)) continue;
      const content = readFileSync(f, "utf8");
      expect(content.includes("governance-record-coverage-probe")).toBe(false);
    }
  });
});

describe("Governance Record Batch 1 — no new cron schedule", () => {
  it("no migration in the tree schedules the coverage probe", () => {
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
      expect(sql).not.toMatch(
        /cron\.schedule\([^)]*governance-record-coverage-probe/i,
      );
    }
  });
});

describe("Governance Record Batch 1 — contract guard parity", () => {
  it("scripts/check-governance-record-coverage-contract.mjs passes", () => {
    expect(() =>
      run("check-governance-record-coverage-contract.mjs"),
    ).not.toThrow();
  });
});
