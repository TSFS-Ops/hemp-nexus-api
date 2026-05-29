#!/usr/bin/env node
/**
 * DATA-004 Phase 2 — non-enforcement guard.
 *
 * Phase 2 is observational/evidence ONLY. The following destructive jobs
 * MUST NOT yet read `org_retention_policies` or call the per-org effective
 * retention helper. Phase 3 will wire them one at a time, with evidence
 * and tests, before that ban is relaxed per-job.
 *
 * Owned-by Phase 2:
 *   - supabase/functions/admin-org-retention/**          (writer + reader)
 *   - src/components/admin/OrgRetentionPanel.tsx         (Phase 1 editor)
 *   - src/components/admin/OrgRetentionHealthPanel.tsx   (Phase 2 evidence)
 *
 * Banned consumers (Phase 2):
 *   - supabase/functions/storage-retention-cleanup/**
 *   - supabase/functions/account-deletion-sweeper/**
 *   - supabase/functions/purge-email-send-log-daily/** (any "purge-email-send-log*")
 *   - supabase/functions/cold-storage-archive/**
 *   - supabase/functions/email-log-anonymise/**
 *
 * If any of those reference the table or the SECURITY DEFINER helper
 * `get_effective_retention_days`, prebuild fails — Phase 3 has not been
 * approved yet.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const BANNED_DIRS = [
  "supabase/functions/storage-retention-cleanup",
  "supabase/functions/account-deletion-sweeper",
  "supabase/functions/cold-storage-archive",
  "supabase/functions/email-log-anonymise",
];
// Match any function whose folder starts with "purge-email-send-log"
const PURGE_PREFIX = "purge-email-send-log";

const FORBIDDEN_TOKENS = [
  "org_retention_policies",
  "get_effective_retention_days",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mjs|sql)$/.test(name)) out.push(p);
  }
  return out;
}

const targets = [];
for (const d of BANNED_DIRS) targets.push(...walk(resolve(ROOT, d)));

// Auto-discover any purge-email-send-log* folder.
const fnRoot = resolve(ROOT, "supabase/functions");
if (existsSync(fnRoot)) {
  for (const name of readdirSync(fnRoot)) {
    if (name.startsWith(PURGE_PREFIX)) {
      targets.push(...walk(join(fnRoot, name)));
    }
  }
}

const violations = [];
for (const file of targets) {
  const src = readFileSync(file, "utf8");
  for (const tok of FORBIDDEN_TOKENS) {
    if (src.includes(tok)) {
      violations.push(`${file}: references forbidden token '${tok}'`);
    }
  }
}

if (violations.length) {
  console.error("✗ DATA-004 Phase 2 non-enforcement guard FAILED:");
  console.error("  Phase 2 is shell + read/evidence only. No sweeper may yet");
  console.error("  consume org_retention_policies / get_effective_retention_days.");
  console.error("  Phase 3 must wire ONE sweeper at a time, with sign-off.\n");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}

console.log(
  `✓ DATA-004 Phase 2 non-enforcement OK: ${targets.length} sweeper file(s) scanned, none consume org_retention_policies.`,
);
