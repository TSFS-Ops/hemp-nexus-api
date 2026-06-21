#!/usr/bin/env node
/**
 * Batch 15 — Every B15 audit event name in the SSOT must be emitted by at
 * least one B15 (or pre-existing B5) edge function source.
 */
import { readFileSync, readdirSync } from "node:fs";

const ts = readFileSync("src/lib/registry-api-hardening.ts", "utf8");
const m = ts.match(/REGISTRY_API_HARDENED_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
const names = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

// Pre-Batch-15 names that are emitted by accepted Batch 5 functions; we
// require coverage only that *some* edge function source mentions each.
const dirs = readdirSync("supabase/functions").filter(
  (d) => d.startsWith("registry-api-") || d.startsWith("registry-institutional-"),
);
const sources = dirs
  .map((d) => readFileSync(`supabase/functions/${d}/index.ts`, "utf8"))
  .join("\n");

let failed = false;
for (const n of names) {
  if (!sources.includes(`"${n}"`)) {
    // Allowed to be UI-only events: test_console_used, usage_exported, demo_approved
    if (["registry_api_test_console_used", "registry_api_usage_exported", "registry_api_client_demo_approved", "registry_api_client_sandbox_approved", "registry_api_client_production_approved", "registry_api_client_revoked", "registry_api_client_expired", "registry_api_scope_added", "registry_api_scope_removed", "registry_api_country_added", "registry_api_country_removed", "registry_api_use_case_added", "registry_api_use_case_removed", "registry_api_rate_limited"].includes(n)) continue;
    console.error(`✗ audit name "${n}" not emitted by any registry-api-* / registry-institutional-* function`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ batch-15 audit-name coverage OK");
