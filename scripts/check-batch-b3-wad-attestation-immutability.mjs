#!/usr/bin/env node
// Batch B3 — static guard for wad_attestations sealed-parent immutability.
//
// Asserts:
//   1. Migration exists installing
//      public.assert_wad_attestation_sealed_parent_immutability + the
//      wad_attestations_sealed_parent_immutability_trg BEFORE UPDATE OR
//      DELETE trigger, checks parent wads.sealed_at, and raises
//      wad_attestation_sealed_parent_immutable.
//   2. Migration performs no GRANT/REVOKE, no CREATE/ALTER/DROP POLICY,
//      no ALTER TABLE OWNER, no FORCE ROW LEVEL SECURITY, and does not
//      touch the Batch B1 wad_attestations_no_truncate_trg.
//   3. No subsequent migration drops/disables the B3 trigger.
//   4. No application/edge/migration code performs UPDATE or DELETE
//      against public.wad_attestations (the rollback-only proof file is
//      the only allowed reference).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = "supabase/migrations";
const migFiles = readdirSync(join(ROOT, MIG_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

let installMig = null;
let installText = "";
for (const f of migFiles) {
  const t = readFileSync(join(ROOT, MIG_DIR, f), "utf8");
  if (
    /CREATE OR REPLACE FUNCTION public\.assert_wad_attestation_sealed_parent_immutability/i.test(t) &&
    /wad_attestations_sealed_parent_immutability_trg/i.test(t)
  ) {
    installMig = f;
    installText = t;
    break;
  }
}

const violations = [];

if (!installMig) {
  violations.push("no migration installs assert_wad_attestation_sealed_parent_immutability + trigger");
} else {
  const s = installText;
  if (!/LANGUAGE\s+plpgsql/i.test(s)) violations.push("function missing LANGUAGE plpgsql");
  if (!/SECURITY\s+DEFINER/i.test(s)) violations.push("function missing SECURITY DEFINER");
  if (!/SET\s+search_path\s*(=|TO)\s*'?public'?/i.test(s))
    violations.push("function missing SET search_path = public");
  if (!/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.wad_attestations/i.test(s))
    violations.push("trigger must be BEFORE UPDATE OR DELETE on public.wad_attestations");
  if (!/FOR\s+EACH\s+ROW/i.test(s)) violations.push("trigger must be FOR EACH ROW");
  if (!/public\.wads\b/i.test(s) || !/sealed_at/i.test(s))
    violations.push("function must check parent public.wads.sealed_at");
  if (!/wad_attestation_sealed_parent_immutable/.test(s))
    violations.push("function must raise wad_attestation_sealed_parent_immutable");
  if (!/check_violation/i.test(s))
    violations.push("function must raise with ERRCODE check_violation");

  // Forbidden non-scope changes in the same migration
  if (/^\s*GRANT\s+/im.test(s)) violations.push("migration must not contain GRANT");
  if (/^\s*REVOKE\s+/im.test(s)) violations.push("migration must not contain REVOKE");
  if (/\bCREATE\s+POLICY\b/i.test(s)) violations.push("migration must not CREATE POLICY");
  if (/\bALTER\s+POLICY\b/i.test(s)) violations.push("migration must not ALTER POLICY");
  if (/\bDROP\s+POLICY\b/i.test(s)) violations.push("migration must not DROP POLICY");
  if (/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(s))
    violations.push("migration must not FORCE ROW LEVEL SECURITY");
  if (/ALTER\s+TABLE[^;]*OWNER\s+TO/i.test(s))
    violations.push("migration must not change table ownership");
  if (/wad_attestations_no_truncate_trg/.test(s))
    violations.push("migration must not touch Batch B1 wad_attestations_no_truncate_trg");
}

// Subsequent migrations must not drop/disable the B3 trigger.
const installIdx = installMig ? migFiles.indexOf(installMig) : -1;
for (let i = installIdx + 1; i < migFiles.length && installIdx >= 0; i++) {
  const t = readFileSync(join(ROOT, MIG_DIR, migFiles[i]), "utf8");
  if (/DROP\s+TRIGGER[^;]*wad_attestations_sealed_parent_immutability_trg/i.test(t))
    violations.push(`${migFiles[i]}: drops B3 trigger`);
  if (/DISABLE\s+TRIGGER[^;]*wad_attestations_sealed_parent_immutability_trg/i.test(t))
    violations.push(`${migFiles[i]}: disables B3 trigger`);
}

// No live UPDATE/DELETE writers on wad_attestations.
const ALLOWED = new Set([
  "supabase/tests/batch_b3_wad_attestation_immutability_proof.sql",
  "scripts/check-batch-b3-wad-attestation-immutability.mjs",
  "evidence/batch-b-append-only-immutability/wad-attestations-sealed-parent/README.md",
]);
const SCAN = ["src", "supabase/functions", "scripts", "e2e"];
function walk(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir); } catch { return out; }
  for (const n of ents) {
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const patterns = [
  /UPDATE\s+(?:public\.)?wad_attestations\b/i,
  /DELETE\s+FROM\s+(?:public\.)?wad_attestations\b/i,
  /\.from\(\s*['"`]wad_attestations['"`]\s*\)[\s\S]{0,200}?\.(update|delete)\s*\(/,
];

for (const d of SCAN) {
  for (const f of walk(join(ROOT, d))) {
    const rel = relative(ROOT, f);
    if (ALLOWED.has(rel)) continue;
    if (!/\.(ts|tsx|js|mjs|sql)$/.test(f)) continue;
    const t = readFileSync(f, "utf8");
    for (const re of patterns) {
      if (re.test(t)) {
        violations.push(`${rel}: forbidden UPDATE/DELETE writer against wad_attestations`);
        break;
      }
    }
  }
}

if (violations.length) {
  console.error("❌ Batch B3 wad_attestation immutability check failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log(`✓ Batch B3 wad_attestation immutability check passed (install migration: ${installMig})`);
