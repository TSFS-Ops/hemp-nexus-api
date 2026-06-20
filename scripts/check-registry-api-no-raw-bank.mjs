#!/usr/bin/env node
/**
 * Batch 5 — Guarantees the institutional API surface never returns raw
 * bank-detail fields. Scans the two institutional facade edge functions for
 * any forbidden token from REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS appearing
 * inside a string literal or property key. The masking helper
 * `maskAccountToken` is allowed.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-institutional-api.ts", "utf8");
const m = ts.match(/REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (!m) { console.error("could not extract REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS"); process.exit(1); }
const forbidden = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

const files = [
  "supabase/functions/registry-institutional-profile-status/index.ts",
  "supabase/functions/registry-institutional-payment-status/index.ts",
  "src/pages/admin/registry/Api.tsx",
];

let failed = false;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const tok of forbidden) {
    if (new RegExp(`\\b${tok}\\b`).test(src)) {
      console.error(`✗ forbidden raw bank field "${tok}" appears in ${f}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("✓ registry-api raw-bank-field guard OK");
