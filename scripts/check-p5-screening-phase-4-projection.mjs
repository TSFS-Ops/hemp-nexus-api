#!/usr/bin/env node
/**
 * P-5 Screening — Phase 4 API-safe projection guard.
 * Pins:
 *   - 2 read RPCs (p5scr_api_subject_status, p5scr_api_gate_readiness)
 *   - SECURITY DEFINER, STABLE, SET search_path = public, REVOKE FROM PUBLIC,
 *     GRANT TO authenticated, platform_admin role guard
 *   - SSOT allowed-wording phrases present
 *   - No SSOT banned wording
 *   - No SSOT forbidden field names referenced
 *   - No new tables, no INSERT/UPDATE/DELETE, no cron, no Memory/finality
 *     mutation, no prior-batch tokens
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(__dirname, "..", "supabase/migrations");
const PREFIX = "20260626181931_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PREFIX));
if (!file) { console.error(`✗ Phase 4 migration ${PREFIX}* not found`); process.exit(1); }
const src = readFileSync(resolve(MIG_DIR, file), "utf8");
const errors = [];
const fail = (m) => { errors.push(m); console.error("  ✗ " + m); };
const ok = (m) => console.log("  ✓ " + m);
ok(`Phase 4 migration: ${file}`);

const RPCS = ["p5scr_api_subject_status", "p5scr_api_gate_readiness"];
for (const fn of RPCS) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b[\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`, "i");
  const m = re.exec(src);
  if (!m) { fail(`RPC ${fn} not created`); continue; }
  const body = m[0];
  if (!/SECURITY DEFINER/.test(body)) fail(`${fn} missing SECURITY DEFINER`);
  if (!/\bSTABLE\b/i.test(body)) fail(`${fn} missing STABLE (read-only)`);
  if (!/SET\s+search_path\s*=\s*public/.test(body)) fail(`${fn} missing SET search_path = public`);
  if (!/has_role\(auth\.uid\(\),\s*'platform_admin'\)/.test(body)) fail(`${fn} missing platform_admin guard`);
  if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\s*\\(`).test(src))
    fail(`${fn} missing REVOKE FROM PUBLIC`);
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)\\s*TO authenticated`).test(src))
    fail(`${fn} missing GRANT EXECUTE TO authenticated`);
}
ok(`${RPCS.length} read RPCs verified`);

// SSOT allowed wording present
const ALLOWED = [
  "Screening pending", "Provider pending", "Manual review required",
  "Identity verification required", "Screening expired",
  "Not ready - counterparty checks pending",
];
for (const phrase of ALLOWED) {
  if (!src.includes(`'${phrase}'`)) fail(`Missing SSOT allowed phrase: "${phrase}"`);
}
ok(`${ALLOWED.length} SSOT allowed phrases pinned`);

// SSOT banned wording must NOT appear
const BANNED = [
  "sanctions hit","sanctioned","pep hit","blacklisted","fraud","criminal",
  "high risk","match confirmed","blocked permanently","illegal","suspicious",
  "guilty","raw provider result","match score","list name",
];
const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
for (const phrase of BANNED) {
  if (codeOnly.toLowerCase().includes(phrase.toLowerCase()))
    fail(`Banned wording leaks into projection: "${phrase}"`);
}
ok(`No SSOT banned wording in projection layer`);

// SSOT forbidden fields must NOT be selected/returned
const FORBIDDEN = [
  "raw_provider_payload","provider_api_secret","id_image","selfie",
  "biometric_template","match_score","list_name","raw_adverse_media",
];
for (const f of FORBIDDEN) {
  if (codeOnly.includes(f))
    fail(`Forbidden field referenced in projection layer: "${f}"`);
}
ok(`No SSOT forbidden fields referenced`);

// Read-only + safety invariants
if (/INSERT\s+INTO/i.test(codeOnly)) fail("Phase 4 must be read-only (INSERT detected)");
if (/UPDATE\s+public\./i.test(codeOnly)) fail("Phase 4 must be read-only (UPDATE detected)");
if (/DELETE\s+FROM/i.test(codeOnly)) fail("Phase 4 must be read-only (DELETE detected)");
if (/CREATE TABLE\s+public\.p5scr_/i.test(src)) fail("Phase 4 must not create new tables");
if (/cron\.schedule\s*\(/i.test(src)) fail("Migration contains pg_cron schedule");
if (/p5_batch5_memory_records/.test(codeOnly)) fail("Projection touches Memory table");
if (/p5_batch4_finality_records/.test(codeOnly)) fail("Projection touches finality table");
ok("Read-only — no INSERT/UPDATE/DELETE, no new tables, no cron, no Memory/finality");

for (const tok of ["p5b6_","p5b7_","p5b8_"]) {
  if (codeOnly.includes(tok)) fail(`Leaks prior-batch token "${tok}"`);
}
ok("No Batch 6/7/8 token leakage");

if (errors.length) {
  console.error(`\n[check-p5-screening-phase-4-projection] FAIL — ${errors.length} issue(s)`);
  process.exit(1);
}
console.log("\n[check-p5-screening-phase-4-projection] OK");
