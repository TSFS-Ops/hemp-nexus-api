#!/usr/bin/env node
/**
 * Batch J1 — static guard for the token_ledger append-only trigger with
 * narrow promotion allowlist (tracker item #35).
 *
 * Asserts that:
 *   1. A migration installs public.assert_token_ledger_append_only and
 *      the token_ledger_append_only_trg BEFORE UPDATE OR DELETE trigger.
 *   2. The trigger blocks all DELETE and raises token_ledger_append_only.
 *   3. The UPDATE allowlist requires credit -> credit_purchase.
 *   4. The approved metadata marker (promoted_by or repaired_by) is required.
 *   5. Balance/identity-affecting columns are protected.
 *   6. The migration does not touch RLS/GRANT/POLICY/FORCE RLS/ownership,
 *      and no later migration drops or disables the trigger.
 *   7. The Batch B1 token_ledger_no_truncate_trg is still installed.
 *   8. No live UPDATE/DELETE token_ledger writers exist outside the two
 *      approved RPCs (atomic_paid_credit_purchase, repair_skeletal_paid_credit).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = "supabase/migrations";
const migs = readdirSync(join(ROOT, MIG_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const violations = [];

// 1) Locate J1 install migration.
let j1File = null;
let j1Text = "";
for (const f of migs) {
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (
    /CREATE OR REPLACE FUNCTION public\.assert_token_ledger_append_only/.test(text) &&
    /CREATE TRIGGER token_ledger_append_only_trg/.test(text)
  ) {
    j1File = f;
    j1Text = text;
    break;
  }
}
if (!j1File) {
  violations.push("no migration installs assert_token_ledger_append_only + token_ledger_append_only_trg");
} else {
  const req = [
    [/LANGUAGE\s+plpgsql/i, "LANGUAGE plpgsql"],
    [/SECURITY\s+DEFINER/i, "SECURITY DEFINER"],
    [/SET\s+search_path\s*(=|TO)\s*public/i, "SET search_path = public"],
    [/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.token_ledger/i, "BEFORE UPDATE OR DELETE on token_ledger"],
    [/FOR\s+EACH\s+ROW/i, "FOR EACH ROW"],
    [/token_ledger_append_only/, "error marker token_ledger_append_only"],
    [/TG_OP\s*=\s*'DELETE'/, "DELETE branch"],
    [/OLD\.action_type\s*=\s*'credit'/, "OLD.action_type = 'credit'"],
    [/NEW\.action_type\s*=\s*'credit_purchase'/, "NEW.action_type = 'credit_purchase'"],
    [/NEW\.metadata\s*\?\s*'promoted_by'/, "promoted_by marker"],
    [/NEW\.metadata\s*\?\s*'repaired_by'/, "repaired_by marker"],
    [/NEW\.org_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.org_id/i, "org_id protected"],
    [/NEW\.tokens_burned\s+IS\s+DISTINCT\s+FROM\s+OLD\.tokens_burned/i, "tokens_burned protected"],
    [/NEW\.remaining_balance\s+IS\s+DISTINCT\s+FROM\s+OLD\.remaining_balance/i, "remaining_balance protected"],
    [/NEW\.request_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.request_id/i, "request_id protected"],
    [/NEW\.created_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_at/i, "created_at protected"],
    [/ERRCODE\s*=\s*'check_violation'/i, "check_violation errcode"],
  ];
  for (const [re, label] of req) {
    if (!re.test(j1Text)) violations.push(`J1 migration missing: ${label}`);
  }

  const forbidden = [
    [/^\s*CREATE\s+POLICY\b/im, "CREATE POLICY"],
    [/^\s*ALTER\s+POLICY\b/im, "ALTER POLICY"],
    [/^\s*DROP\s+POLICY\b/im, "DROP POLICY"],
    [/^\s*GRANT\s+/im, "GRANT"],
    [/^\s*REVOKE\s+/im, "REVOKE"],
    [/FORCE\s+ROW\s+LEVEL\s+SECURITY/i, "FORCE RLS"],
    [/OWNER\s+TO/i, "OWNER TO"],
    [/DROP\s+TRIGGER\s+.*token_ledger_no_truncate_trg/i, "drops B1 truncate trigger"],
  ];
  for (const [re, label] of forbidden) {
    if (re.test(j1Text)) violations.push(`J1 migration must not contain: ${label}`);
  }
}

// 2) No later migration drops/disables the J1 trigger or its function.
if (j1File) {
  for (const f of migs) {
    if (f <= j1File) continue;
    const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
    if (/DROP\s+TRIGGER\s+.*token_ledger_append_only_trg/i.test(text))
      violations.push(`later migration drops J1 trigger: ${f}`);
    if (/ALTER\s+TABLE\s+public\.token_ledger\s+DISABLE\s+TRIGGER\s+token_ledger_append_only_trg/i.test(text))
      violations.push(`later migration disables J1 trigger: ${f}`);
    if (/DROP\s+FUNCTION\s+.*assert_token_ledger_append_only/i.test(text))
      violations.push(`later migration drops J1 function: ${f}`);
  }
}

// 3) B1 TRUNCATE trigger still installed.
let b1Found = false;
for (const f of migs) {
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (/CREATE TRIGGER token_ledger_no_truncate_trg/i.test(text)) {
    b1Found = true;
    break;
  }
}
if (!b1Found) violations.push("Batch B1 token_ledger_no_truncate_trg missing");

// 4) No live UPDATE/DELETE writers outside the two approved RPCs.
//    Scan src/, supabase/functions/, scripts/, e2e/ for supabase client writes.
const SCAN_DIRS = ["src", "supabase/functions", "scripts", "e2e"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".next") continue;
      walk(p, out);
    } else if (SCAN_EXT.has(extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}
const files = SCAN_DIRS.flatMap((d) => walk(d));
const writerRe = /\.from\(\s*["']token_ledger["']\s*\)[\s\S]{0,200}?\.(update|delete)\s*\(/;
for (const f of files) {
  // Guard scripts themselves reference these patterns as regex strings — skip.
  if (/scripts\/check-.*\.mjs$/.test(f)) continue;
  const text = readFileSync(join(ROOT, f), "utf8");
  if (writerRe.test(text)) {
    violations.push(`live token_ledger UPDATE/DELETE writer outside approved RPCs: ${f}`);
  }
}

if (violations.length) {
  console.error("✗ Batch J1 token_ledger append-only guard failed:");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
console.log(`✓ Batch J1 token_ledger append-only guard passed (install migration: ${j1File})`);
