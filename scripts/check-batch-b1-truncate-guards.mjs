#!/usr/bin/env node
// Batch B1 — static guard for TRUNCATE protection on append-only / sealed
// immutability tables.
//
// Asserts that:
//   1. The Batch B1 migration exists and contains the shared trigger
//      function `prevent_protected_table_truncate` and a BEFORE TRUNCATE
//      trigger for each of the 8 protected tables.
//   2. No subsequent migration drops those triggers, disables them, or
//      forces RLS on the protected tables.
//   3. No application/edge/migration code TRUNCATEs any protected table
//      (the rollback-only proof file is the single exception).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const PROTECTED_TABLES = [
  "event_store",
  "match_events",
  "poi_events",
  "audit_logs",
  "admin_audit_logs",
  "wads",
  "token_ledger",
  "wad_attestations",
];

const TRIGGER_NAMES = PROTECTED_TABLES.map((t) => `${t}_no_truncate_trg`);

const MIG_DIR = "supabase/migrations";
const migrationFiles = readdirSync(join(ROOT, MIG_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// 1) Locate the Batch B1 migration that installs the function + triggers.
let installMigration = null;
let installText = "";
for (const f of migrationFiles) {
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (
    /CREATE OR REPLACE FUNCTION public\.prevent_protected_table_truncate/.test(
      text,
    ) &&
    TRIGGER_NAMES.every((name) => text.includes(name))
  ) {
    installMigration = f;
    installText = text;
    break;
  }
}

const violations = [];

if (!installMigration) {
  violations.push(
    "no migration installs public.prevent_protected_table_truncate + all 8 BEFORE TRUNCATE triggers",
  );
} else {
  for (const t of PROTECTED_TABLES) {
    const expected = `${t}_no_truncate_trg`;
    const re = new RegExp(
      `CREATE TRIGGER\\s+${expected}\\s+BEFORE TRUNCATE ON public\\.${t}\\s+FOR EACH STATEMENT\\s+EXECUTE FUNCTION public\\.prevent_protected_table_truncate`,
      "i",
    );
    if (!re.test(installText)) {
      violations.push(
        `${installMigration}: missing well-formed BEFORE TRUNCATE trigger ${expected} on public.${t}`,
      );
    }
  }
}

// 2) Subsequent migrations must not drop/disable/force-RLS the protected
//    tables or triggers.
const installIdx = installMigration
  ? migrationFiles.indexOf(installMigration)
  : -1;

for (let i = 0; i < migrationFiles.length; i++) {
  if (i <= installIdx) continue;
  const f = migrationFiles[i];
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");

  for (const trg of TRIGGER_NAMES) {
    if (new RegExp(`DROP TRIGGER[^;]*\\b${trg}\\b`, "i").test(text)) {
      violations.push(`${f}: drops protected trigger ${trg}`);
    }
    if (new RegExp(`DISABLE TRIGGER[^;]*\\b${trg}\\b`, "i").test(text)) {
      violations.push(`${f}: disables protected trigger ${trg}`);
    }
  }

  for (const t of PROTECTED_TABLES) {
    if (
      new RegExp(`ALTER TABLE\\s+(?:public\\.)?${t}\\s+FORCE ROW LEVEL SECURITY`, "i").test(
        text,
      )
    ) {
      violations.push(
        `${f}: FORCE ROW LEVEL SECURITY applied to public.${t} (Batch B1 forbids broad FORCE RLS — use trigger-based protection instead)`,
      );
    }
  }
}

// 3) No production code/migration may TRUNCATE a protected table. The
//    rollback-only proof file is the only allowed reference.
const ALLOW_TRUNCATE_REFS = new Set([
  "supabase/tests/batch_b1_truncate_guards_proof.sql",
  "scripts/check-batch-b1-truncate-guards.mjs",
  "evidence/batch-b-append-only-immutability/truncate-guards/README.md",
]);

const SCAN_DIRS = ["src", "supabase", "scripts", "e2e"];
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

for (const d of SCAN_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file);
    if (ALLOW_TRUNCATE_REFS.has(rel)) continue;
    if (!/\.(ts|tsx|js|mjs|sql)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const t of PROTECTED_TABLES) {
      const re = new RegExp(`TRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?(?:public\\.)?${t}\\b`, "i");
      if (re.test(text)) {
        violations.push(`${rel}: TRUNCATE of protected table public.${t} is forbidden outside the rollback-only proof`);
      }
    }
  }
}

if (violations.length) {
  console.error("❌ Batch B1 TRUNCATE-guards check failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}

console.log(
  `✓ Batch B1 TRUNCATE-guards check passed (${PROTECTED_TABLES.length} protected tables, install migration: ${installMigration})`,
);
