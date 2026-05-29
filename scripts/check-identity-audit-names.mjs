#!/usr/bin/env node
/**
 * Batch 4 — Identity audit-name SSOT parity guard.
 *
 * Asserts that the 10 canonical identity audit names exist in BOTH the
 * Deno SSOT (supabase/functions/_shared/identity-audit.ts) and the
 * browser SSOT (src/lib/identity/identity-audit.ts), and that edge
 * functions only emit them via IDENTITY_AUDIT_NAMES (no inline string
 * literals).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "identity.sso_config_created",
  "identity.sso_metadata_updated",
  "identity.sso_domains_updated",
  "identity.sso_connection_tested",
  "identity.sso_enabled",
  "identity.sso_disabled",
  "identity.sso_failed",
  "identity.scim_user_provisioned",
  "identity.scim_user_suspended",
  "identity.scim_user_deprovisioned",
];

const SSOT_FILES = [
  "supabase/functions/_shared/identity-audit.ts",
  "src/lib/identity/identity-audit.ts",
];

const errors = [];

for (const f of SSOT_FILES) {
  const path = resolve(ROOT, f);
  if (!existsSync(path)) {
    errors.push(`Missing SSOT file: ${f}`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) {
      errors.push(`${f} missing canonical audit name "${name}"`);
    }
  }
}

// Walk identity-related edge functions for inline literals.
const EDGE_DIR = resolve(ROOT, "supabase/functions");
const ALLOWED_FILES = new Set([
  "supabase/functions/_shared/identity-audit.ts",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const allFiles = walk(EDGE_DIR);
for (const file of allFiles) {
  const rel = file.slice(ROOT.length + 1);
  if (ALLOWED_FILES.has(rel)) continue;
  if (!/(org-sso|org-scim)/.test(rel)) continue;
  const src = readFileSync(file, "utf8");
  for (const name of REQUIRED) {
    // Inline literal usage outside the SSOT is a drift bug.
    if (src.includes(`"${name}"`)) {
      errors.push(`${rel} hard-codes "${name}" — import from IDENTITY_AUDIT_NAMES instead`);
    }
  }
}

if (errors.length) {
  console.error("✗ Identity audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(`✓ Identity audit names: ${REQUIRED.length} canonical names present in both SSOTs.`);
