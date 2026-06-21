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

// Substrings that classify a table as "sensitive" for this guard.
const SENSITIVE = [
  "bank", "claim", "authority", "verification", "verified",
  "payment", "ledger", "identity", "audit", "approval",
  "poi", "kyc", "ubo", "screening",
];

// table_name -> reason. Anything here is exempt and MUST carry an
// in-repo justification.
const ALLOW: Record<string, string> = {
  // none — keep empty until a specific case is justified in writing.
};

const violations: string[] = [];

for (const file of readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = readFileSync(join(MIG_DIR, file), "utf8");
  // Naive scan: find CREATE POLICY blocks that mention WITH CHECK (true)
  // and are NOT FOR SELECT.
  const policyRegex =
    /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)([\s\S]*?);/gi;
  let m: RegExpExecArray | null;
  while ((m = policyRegex.exec(sql))) {
    const [, , table, body] = m;
    if (!new RegExp(SENSITIVE.join("|"), "i").test(table)) continue;
    if (/FOR\s+SELECT/i.test(body)) continue;
    if (!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(body)) continue;
    if (ALLOW[table]) continue;
    // Skip service_role-only policies (those are admin-side).
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
