#!/usr/bin/env node
// Prebuild guard: forbid UPDATE/DELETE/INSERT RLS policies with
// `WITH CHECK (true)` on sensitive financial / banking / authority /
// claim / POI / identity / audit tables.
//
// SELECT policies are not scanned (USING (true) is sometimes intentional
// for public reads). Tables can be allowlisted only with a written
// justification recorded in ALLOW.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";

const SENSITIVE = [
  "bank", "claim", "authority", "verification", "verified",
  "payment", "ledger", "identity", "audit", "approval",
  "poi", "kyc", "ubo", "screening",
];

// table_name -> written justification. Anything here is exempt and is
// tracked separately as a known finding.
const ALLOW = {
  // Anon-write audit-trail table. INSERT-only, no UPDATE/DELETE. The
  // separate `anon_insert_claim_interest` finding tracks rate-limit /
  // payload-size hardening for this surface.
  registry_claim_interest_events:
    "anon INSERT-only audit log; size & rate hardening tracked separately",
};

const violations = [];

for (const file of readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = readFileSync(join(MIG_DIR, file), "utf8");
  const policyRegex =
    /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)([\s\S]*?);/gi;
  let m;
  while ((m = policyRegex.exec(sql))) {
    const [, , table, body] = m;
    if (!new RegExp(SENSITIVE.join("|"), "i").test(table)) continue;
    if (/FOR\s+SELECT/i.test(body)) continue;
    if (!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(body)) continue;
    if (ALLOW[table]) continue;
    if (/TO\s+service_role\b/i.test(body) && !/TO\s+(authenticated|anon|public)\b/i.test(body)) continue;
    violations.push(`${file}: CREATE POLICY on ${table} uses WITH CHECK (true) for non-SELECT`);
  }
}

if (violations.length) {
  console.error("❌ sensitive table RLS WITH CHECK (true) guard failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("✓ sensitive table RLS WITH CHECK (true) guard passed");
