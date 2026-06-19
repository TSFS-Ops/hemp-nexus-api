#!/usr/bin/env node
/**
 * Public API V1 — Sandprod Batch 3 audit-name SSOT parity guard.
 *
 * Asserts that every canonical Public API audit name from this workstream
 * is present somewhere in supabase/functions/** so that drift between the
 * scope brief and the deployed edge functions is caught at build time.
 *
 * Legacy api_key.* and api_key.v1.* events are NOT enforced here — they
 * remain accepted for back-compat with earlier batches.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FN_DIR = resolve(ROOT, "supabase/functions");

const REQUIRED = [
  "api.sandbox_key.created",
  "api.sandbox_key.rotated",
  "api.sandbox_key.suspended",
  "api.sandbox_key.revoked",
  "api.sandbox_key.expiry_warning",
  "api.production_key.created",
  "api.production_key.creation_blocked",
  "api.production_key.rotated",
  "api.production_key.suspended",
  "api.production_key.revoked",
  "api.production_key.expiry_warning_30d",
  "api.production_key.expiry_warning_14d",
  "api.production_key.expiry_warning_3d",
  "api.production_access.checklist_failed",
  "api.production_access.platform_admin_approved",
  "api.production_access.commercial_owner_signed_off",
  "api.production_access.compliance_owner_signed_off",
  "api.production_access.rejected",
  "api.production_access.reset",
  "api.production_access.approved",
  // ─── Sand/Prod Batch 7 — public-API webhook taxonomy ───────────────
  "api.webhook.endpoint.created",
  "api.webhook.endpoint.updated",
  "api.webhook.endpoint.enabled",
  "api.webhook.endpoint.disabled",
  "api.webhook.test.sent",
  "api.webhook.delivery.succeeded",
  "api.webhook.delivery.failed",
  "api.webhook.delivery.retry_scheduled",
  "api.webhook.production.enabled",
  "api.webhook.production.blocked_until_sandbox_tested",
];

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

const files = walk(FN_DIR);
const corpus = files.map((f) => readFileSync(f, "utf8")).join("\n\n");

const missing = REQUIRED.filter((name) =>
  !corpus.includes(`"${name}"`) && !corpus.includes(`'${name}'`)
);

if (missing.length > 0) {
  console.error("FAIL — Public API V1 canonical audit names missing from edge functions:");
  for (const m of missing) console.error("  - " + m);
  console.error("\nAdd the emission in the appropriate function under supabase/functions/.");
  process.exit(1);
}

console.log(`OK — all ${REQUIRED.length} Public API V1 canonical audit names present.`);
