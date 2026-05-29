#!/usr/bin/env node
/**
 * DATA-004 Phase 3 enforcement-scope guard (formerly Phase 2 no-enforcement).
 *
 * Phase 3 wires EXACTLY ONE retention sweeper to per-org policy:
 *   - supabase/functions/purge-email-send-log-daily/**
 *
 * Every other sweeper / archive / deletion path remains forbidden from
 * referencing `org_retention_policies` or the SECURITY DEFINER reader
 * `get_effective_retention_days`. Adding new consumers requires their
 * own dedicated phase, evidence, and tests.
 *
 * Banned consumers (still Phase 3-deferred):
 *   - supabase/functions/storage-retention-cleanup/**
 *   - supabase/functions/account-deletion-sweeper/**
 *   - supabase/functions/cold-storage-archive/**
 *   - supabase/functions/email-log-anonymise/**
 *
 * Owned-by retention shell + evidence + Phase 3 wiring:
 *   - supabase/functions/admin-org-retention/**
 *   - supabase/functions/purge-email-send-log-daily/**
 *   - supabase/functions/_shared/retention-decision.ts
 *   - src/components/admin/OrgRetentionPanel.tsx
 *   - src/components/admin/OrgRetentionHealthPanel.tsx
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
  console.error("✗ DATA-004 Phase 3 enforcement-scope guard FAILED:");
  console.error("  Phase 3 wires ONLY purge-email-send-log-daily.");
  console.error("  Any other sweeper consuming org_retention_policies /");
  console.error("  get_effective_retention_days needs its own approved phase.\n");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}

console.log(
  `✓ DATA-004 Phase 3 enforcement-scope OK: ${targets.length} deferred sweeper file(s) scanned, none consume org_retention_policies.`,
);
