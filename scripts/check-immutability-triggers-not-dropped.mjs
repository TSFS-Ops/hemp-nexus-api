#!/usr/bin/env node
// Batch D2 — static guard against dropping / disabling / silently replacing
// the append-only, seal-immutability, and TRUNCATE-protection triggers and
// functions that back tracker item #52.
//
// Fails the build if any migration under supabase/migrations/ contains
// dangerous DDL against the protected trigger/function names below, unless
// that migration is on the narrow allowlist of migrations that legitimately
// create or replace them.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

const PROTECTED_TRIGGERS = [
  "wads_seal_immutability_trg",
  "wad_attestations_sealed_parent_immutability_trg",
  "wad_attestations_no_truncate_trg",
  "token_ledger_no_truncate_trg",
  "event_store_no_truncate_trg",
  "match_events_no_truncate_trg",
  "poi_events_no_truncate_trg",
  "audit_logs_no_truncate_trg",
  "admin_audit_logs_no_truncate_trg",
  "match_events_append_only_trg",
  "poi_events_append_only_trg",
  "event_store_no_mutation_trg",
  "audit_logs_immutable_trg",
  "audit_logs_no_update_trg",
  "audit_logs_no_delete_trg",
];

const PROTECTED_FUNCTIONS = [
  "assert_wad_seal_immutability",
  "assert_wad_attestation_sealed_parent_immutability",
  "prevent_protected_table_truncate",
  "prevent_event_store_mutation",
  "assert_match_events_append_only",
  "assert_poi_events_append_only",
  "assert_audit_immutable",
];

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

// Narrow allowlist: migrations that legitimately create / replace protected
// functions or triggers. Any future rescue migration must be added here
// explicitly with a comment.
const ALLOWLIST = new Set([
  // Historical append-only / immutability installers, discovered by
  //   grep -lE "prevent_protected_table_truncate|assert_wad_seal_immutability|
  //     assert_wad_attestation_sealed_parent|prevent_event_store_mutation|
  //     assert_match_events_append_only|assert_poi_events_append_only|
  //     assert_audit_immutable" supabase/migrations/*.sql
  "20260304000110_78461db3-fe8c-46bd-853b-7b5400676ca1.sql",
  "20260313183323_7be968d4-d8ad-471d-aa68-8cdc18d19bb1.sql",
  "20260516173105_defd936d-71d5-4c0a-a6a5-ff0583ca66eb.sql",
  "20260623171758_21ffd4f6-87fe-422e-a6d0-04661b2a80c4.sql",
  "20260623181731_89c77f66-e6f0-4c06-8b14-88bc3cd3f294.sql",
  "20260630182822_3235590c-52d3-48f4-9d0c-372bd40aa08c.sql",
  "20260630221850_c6d1222c-0f9f-4906-8465-c2b37bc4750a.sql",
  "20260701074823_29b9b2a9-7998-4db4-ba77-7e471a2a82fd.sql",
]);

const violations = [];

const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  const text = readFileSync(join(MIG_DIR, f), "utf8");
  const allowed = ALLOWLIST.has(f);

  // 1) DROP / DISABLE of a named protected trigger.
  //    Allowlisted installer migrations may DROP TRIGGER IF EXISTS as part
  //    of their idempotent CREATE. Any other migration is forbidden.
  for (const trg of PROTECTED_TRIGGERS) {
    if (!allowed && new RegExp(`DROP\\s+TRIGGER[^;]*\\b${trg}\\b`, "i").test(text)) {
      violations.push(`${f}: DROP TRIGGER on protected ${trg}`);
    }
    if (new RegExp(`DISABLE\\s+TRIGGER[^;]*\\b${trg}\\b`, "i").test(text)) {
      violations.push(`${f}: DISABLE TRIGGER on protected ${trg}`);
    }
  }

  // 2) Broad DISABLE TRIGGER ALL / DISABLE TRIGGER USER on a protected table.
  for (const t of PROTECTED_TABLES) {
    const re = new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?${t}\\b[^;]*DISABLE\\s+TRIGGER\\s+(ALL|USER)\\b`,
      "i",
    );
    if (re.test(text)) {
      violations.push(`${f}: broad DISABLE TRIGGER ALL/USER on protected table public.${t}`);
    }
  }

  // 3) DROP / ALTER of a protected function — always forbidden.
  //    CREATE OR REPLACE is allowed only inside allowlisted migrations.
  for (const fn of PROTECTED_FUNCTIONS) {
    if (new RegExp(`DROP\\s+FUNCTION[^;]*\\b${fn}\\b`, "i").test(text)) {
      violations.push(`${f}: DROP FUNCTION on protected public.${fn}`);
    }
    if (new RegExp(`ALTER\\s+FUNCTION[^;]*\\b${fn}\\b`, "i").test(text)) {
      violations.push(`${f}: ALTER FUNCTION on protected public.${fn}`);
    }
    if (
      !allowed &&
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION[^;(]*\\b${fn}\\b`, "i").test(text)
    ) {
      violations.push(
        `${f}: CREATE/REPLACE of protected public.${fn} outside the allowlist — add the migration to the allowlist in scripts/check-immutability-triggers-not-dropped.mjs with a rescue justification`,
      );
    }
  }
}

if (violations.length) {
  console.error("❌ Batch D2 immutability-triggers-not-dropped check failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}

console.log(
  `✓ Batch D2 immutability-triggers-not-dropped check passed (${files.length} migrations scanned, ${ALLOWLIST.size} allowlisted, ${PROTECTED_TRIGGERS.length} triggers + ${PROTECTED_FUNCTIONS.length} functions protected)`,
);
