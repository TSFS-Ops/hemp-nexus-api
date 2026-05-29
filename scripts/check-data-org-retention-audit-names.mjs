#!/usr/bin/env node
/**
 * DATA-004 audit-name parity guard.
 *
 * Canonical names emitted by supabase/functions/admin-org-retention/index.ts:
 *   - data.org_retention_policy.set
 *   - data.org_retention_policy.cleared
 *
 * If these drift, prebuild fails. CI must catch this BEFORE any downstream
 * consumer (reports, retention dashboards, governance record reconciliation)
 * starts swallowing renamed events.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = {
  set: "data.org_retention_policy.set",
  cleared: "data.org_retention_policy.cleared",
};

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}

const errors = [];

const fn = read("supabase/functions/admin-org-retention/index.ts");
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!fn.includes(`"${v}"`)) {
    errors.push(`admin-org-retention/index.ts missing canonical audit name '${v}' (key=${k})`);
  }
}

// Ensure the constant block exists and uses canonical wording.
if (!/ORG_RETENTION_AUDIT_NAMES\s*=\s*\{[^}]*set:\s*"data\.org_retention_policy\.set"/s.test(fn)) {
  errors.push("ORG_RETENTION_AUDIT_NAMES.set must equal 'data.org_retention_policy.set'");
}
if (!/ORG_RETENTION_AUDIT_NAMES\s*=\s*\{[^}]*cleared:\s*"data\.org_retention_policy\.cleared"/s.test(fn)) {
  errors.push("ORG_RETENTION_AUDIT_NAMES.cleared must equal 'data.org_retention_policy.cleared'");
}

// Both emission sites must reference the constant (not inline strings) to
// keep the drift surface small.
if (!fn.includes("ORG_RETENTION_AUDIT_NAMES.set")) {
  errors.push("admin-org-retention/index.ts does not emit ORG_RETENTION_AUDIT_NAMES.set");
}
if (!fn.includes("ORG_RETENTION_AUDIT_NAMES.cleared")) {
  errors.push("admin-org-retention/index.ts does not emit ORG_RETENTION_AUDIT_NAMES.cleared");
}

if (errors.length) {
  console.error("✗ DATA-004 audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-004 audit-name parity OK:", Object.values(REQUIRED).join(", "));
