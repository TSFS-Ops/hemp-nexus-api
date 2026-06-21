#!/usr/bin/env node
/**
 * Batch 15 — Forbidden API scopes must not appear in any granted scope or
 * any non-SSOT/non-guard file as a live value.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ts = readFileSync("src/lib/registry-api-hardening.ts", "utf8");
const m = ts.match(/REGISTRY_API_FORBIDDEN_SCOPES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
const forbidden = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

const allowed = new Set([
  "src/lib/registry-api-hardening.ts",
  "supabase/functions/_shared/registry-api-hardening.ts",
  "scripts/check-batch-15-forbidden-scopes.mjs",
  "scripts/check-batch-15-ssot-parity.mjs",
  "src/tests/batch-15-institutional-api-hardening.test.ts",
]);

let failed = false;
for (const tok of forbidden) {
  let out;
  try { out = execSync(`rg -l --no-messages -F ${JSON.stringify(tok)} src supabase scripts`, { encoding: "utf8" }); }
  catch { out = ""; }
  for (const f of out.split("\n").filter(Boolean)) {
    const norm = f.replace(/^\.\//, "");
    if (allowed.has(norm)) continue;
    // Allow migration files that only DECLARE the forbidden list inside the helper function.
    if (norm.startsWith("supabase/migrations/")) continue;
    console.error(`✗ forbidden scope "${tok}" appears in ${norm}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ batch-15 forbidden-scopes guard OK");
