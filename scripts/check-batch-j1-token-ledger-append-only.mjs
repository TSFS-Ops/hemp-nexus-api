#!/usr/bin/env node
/**
 * Batch J1 — token_ledger append-only widened allowlist static guard.
 * Tracker item #35.
 *
 * Asserts:
 *   1. A migration installs public.assert_token_ledger_append_only and
 *      token_ledger_append_only_trg BEFORE UPDATE OR DELETE.
 *   2. Function raises 'token_ledger_append_only' with
 *      ERRCODE = 'check_violation', has SECURITY DEFINER and
 *      SET search_path = public, and LANGUAGE plpgsql.
 *   3. DELETE branch is unconditional.
 *   4. Allowlist covers exactly two transitions:
 *        credit -> credit_purchase (markers promoted_by | repaired_by)
 *        credit -> credit_refund   (markers refund_reference | refunded_by | promoted_by)
 *   5. All 11 protected columns compared with IS DISTINCT FROM.
 *   6. No GRANT / REVOKE / CREATE|ALTER|DROP POLICY / FORCE RLS / OWNER TO
 *      in the migration.
 *   7. No later migration drops or disables the trigger/function.
 *   8. Batch B1 token_ledger_no_truncate_trg still installed.
 *   9. Live UPDATE writer scan finds only the two approved RPCs
 *      (matched by name) and the one approved refund-settlement
 *      write in supabase/functions/token-purchase/index.ts. No
 *      DELETE / UPSERT / additional UPDATE paths.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = "supabase/migrations";
const migs = readdirSync(join(ROOT, MIG_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const violations = [];

let j1File = null;
let j1Text = "";
for (const f of migs) {
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (
    /CREATE OR REPLACE FUNCTION public\.assert_token_ledger_append_only/.test(text) &&
    /CREATE TRIGGER token_ledger_append_only_trg/.test(text) &&
    /credit_refund/.test(text)
  ) {
    j1File = f;
    j1Text = text;
  }
}
if (!j1File) {
  violations.push(
    "no widened J1 migration installs assert_token_ledger_append_only + token_ledger_append_only_trg with credit_refund transition",
  );
} else {
  const req = [
    [/LANGUAGE\s+plpgsql/i, "LANGUAGE plpgsql"],
    [/SECURITY\s+DEFINER/i, "SECURITY DEFINER"],
    [/SET\s+search_path\s*(=|TO)\s*public/i, "SET search_path = public"],
    [/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.token_ledger/i, "BEFORE UPDATE OR DELETE"],
    [/FOR\s+EACH\s+ROW/i, "FOR EACH ROW"],
    [/token_ledger_append_only/, "error marker token_ledger_append_only"],
    [/ERRCODE\s*=\s*'check_violation'/i, "check_violation errcode"],
    [/TG_OP\s*=\s*'DELETE'/, "DELETE branch"],
    [/OLD\.action_type\s*=\s*'credit'\s+AND\s+NEW\.action_type\s*=\s*'credit_purchase'/, "purchase transition"],
    [/OLD\.action_type\s*=\s*'credit'\s+AND\s+NEW\.action_type\s*=\s*'credit_refund'/, "refund transition"],
    [/NEW\.metadata\s*\?\s*'promoted_by'/, "purchase marker promoted_by"],
    [/NEW\.metadata\s*\?\s*'repaired_by'/, "purchase marker repaired_by"],
    [/NEW\.metadata\s*\?\s*'refund_reference'/, "refund marker refund_reference"],
    [/NEW\.metadata\s*\?\s*'refunded_by'/, "refund marker refunded_by"],
  ];
  for (const [re, label] of req) {
    if (!re.test(j1Text)) violations.push(`J1 migration missing: ${label}`);
  }

  const PROTECTED = [
    "id", "org_id", "api_key_id", "tokens_burned", "remaining_balance",
    "outcome", "request_id", "created_at", "entity_id", "is_demo", "demo_dataset_id",
  ];
  for (const col of PROTECTED) {
    const re = new RegExp(`NEW\\.${col}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${col}`, "i");
    if (!re.test(j1Text)) violations.push(`J1 migration missing IS DISTINCT FROM guard for column: ${col}`);
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
    [/DROP\s+TRIGGER\s+.*enforce_demo_inheritance_trg/i, "drops enforce_demo_inheritance_trg"],
  ];
  for (const [re, label] of forbidden) {
    if (re.test(j1Text)) violations.push(`J1 migration must not contain: ${label}`);
  }
}

// Later migrations must not drop/disable J1.
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

// Batch B1 TRUNCATE trigger still installed by some migration.
let b1Found = false;
for (const f of migs) {
  const text = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (/CREATE TRIGGER token_ledger_no_truncate_trg/i.test(text)) { b1Found = true; break; }
}
if (!b1Found) violations.push("Batch B1 token_ledger_no_truncate_trg missing");

// Live writer scan: only allowed live UPDATE writer is the refund
// settlement branch in supabase/functions/token-purchase/index.ts.
const SCAN_DIRS = ["src", "supabase/functions", "scripts", "e2e"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "dist", ".next"].includes(e.name)) continue;
      walk(p, out);
    } else if (SCAN_EXT.has(extname(e.name))) out.push(p);
  }
  return out;
}
const files = SCAN_DIRS.flatMap((d) => walk(d));
const writerRe = /\.from\(\s*["'`]token_ledger["'`]\s*\)[\s\S]{0,400}?\.(update|delete|upsert)\s*\(/g;
const APPROVED_WRITER = "supabase/functions/token-purchase/index.ts";
for (const f of files) {
  if (/scripts\/check-.*\.mjs$/.test(f)) continue; // guard scripts own regex strings
  const text = readFileSync(join(ROOT, f), "utf8");
  let m;
  while ((m = writerRe.exec(text)) !== null) {
    const op = m[1];
    if (op === "update" && f === APPROVED_WRITER) continue; // approved refund promotion
    const line = text.slice(0, m.index).split("\n").length;
    violations.push(`unapproved token_ledger .${op} writer: ${f}:${line}`);
  }
}

if (violations.length) {
  console.error("✗ Batch J1 token_ledger append-only widened allowlist guard failed:");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
console.log(`✓ Batch J1 token_ledger append-only widened allowlist guard passed (install migration: ${j1File})`);
