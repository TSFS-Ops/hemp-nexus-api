#!/usr/bin/env node
/**
 * DATA-003 audit-name parity guard.
 *
 * Single source of truth lives in supabase/functions/_shared/legal-hold.ts
 * (LEGAL_HOLD_AUDIT_NAMES). This script asserts:
 *   1. the three canonical names are present and unchanged
 *   2. apply/release audits are emitted from admin-legal-hold
 *   3. the deletion-blocked audit is emitted from the shared helper
 *
 * If any of these drift, prebuild fails. CI must catch this BEFORE any
 * downstream consumer (notifications, reports, retention dashboards)
 * starts swallowing renamed events.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = {
  applied: "data.legal_hold_applied",
  released: "data.legal_hold_released",
  deletion_blocked: "data.deletion_blocked_legal_hold",
};

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}

const errors = [];

// 1. Canonical names declared in the helper.
const helper = read("supabase/functions/_shared/legal-hold.ts");
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!helper.includes(`"${v}"`)) {
    errors.push(`legal-hold.ts missing canonical audit name '${v}' (key=${k})`);
  }
}

// 2. Emission sites.
const adminFn = read("supabase/functions/admin-legal-hold/index.ts");
if (!adminFn.includes("LEGAL_HOLD_AUDIT_NAMES.applied")) {
  errors.push("admin-legal-hold/index.ts does not emit LEGAL_HOLD_AUDIT_NAMES.applied");
}
if (!adminFn.includes("LEGAL_HOLD_AUDIT_NAMES.released")) {
  errors.push("admin-legal-hold/index.ts does not emit LEGAL_HOLD_AUDIT_NAMES.released");
}
if (!helper.includes('action: "data.deletion_blocked_legal_hold"')) {
  errors.push("legal-hold.ts no longer emits data.deletion_blocked_legal_hold on block");
}

if (errors.length) {
  console.error("✗ DATA-003 audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-003 audit-name parity OK:", Object.values(REQUIRED).join(", "));
