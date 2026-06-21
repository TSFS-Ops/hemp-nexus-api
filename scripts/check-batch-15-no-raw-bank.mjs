#!/usr/bin/env node
/**
 * Batch 15 — No raw or masked bank-detail fields in any B15 API response surface.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-api-hardening.ts", "utf8");
const m = ts.match(/REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
const forbidden = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

const files = [
  "supabase/functions/registry-api-profile-status/index.ts",
  "supabase/functions/registry-api-payment-status/index.ts",
  "supabase/functions/registry-api-readiness-status/index.ts",
  "supabase/functions/registry-api-coverage-status/index.ts",
  "supabase/functions/registry-api-client-key-manage/index.ts",
];

let failed = false;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const tok of forbidden) {
    if (new RegExp(`\\b${tok}\\b`).test(src)) {
      console.error(`✗ forbidden field "${tok}" appears in ${f}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("✓ batch-15 no-raw-bank / no-masked-bank / no-personal-contact guard OK");
