#!/usr/bin/env node
/**
 * P-4 Point 4 endpoint-wiring guard.
 *
 * Proves that at least one real production-client institutional API endpoint
 * actually calls the shared `burnArtefactForApiCall` helper, AND that any
 * endpoint we declare as `chargeable_now` is wired.
 *
 * Failing this guard means we are claiming "live burn" without an endpoint
 * that demonstrates it — that's the embarrassment risk this batch closes.
 */
import { readFileSync, existsSync } from "node:fs";

// === Endpoint inventory (mirrors evidence/.../README.md) ===
// chargeable_now MUST import burnArtefactForApiCall.
const CHARGEABLE_NOW = [
  "supabase/functions/registry-api-profile-status/index.ts",
];

// Endpoints intentionally NOT wired this batch (documented in evidence).
const NON_CHARGEABLE_OR_DEFERRED = [
  "supabase/functions/registry-api-payment-status/index.ts",  // status-only flag, no governed artefact returned
  "supabase/functions/registry-api-coverage-status/index.ts", // coverage metadata, non-priced
  "supabase/functions/registry-api-readiness-status/index.ts",// readiness metadata, non-priced
];

const NEEDLE = "burnArtefactForApiCall";
let failed = 0;

for (const path of CHARGEABLE_NOW) {
  if (!existsSync(path)) {
    console.error(`✗ Missing chargeable_now endpoint file: ${path}`);
    failed++;
    continue;
  }
  const body = readFileSync(path, "utf8");
  if (!body.includes(NEEDLE)) {
    console.error(`✗ chargeable_now endpoint does NOT call ${NEEDLE}: ${path}`);
    failed++;
    continue;
  }
  if (!body.includes("buildInsufficientCreditsBody")) {
    console.error(`✗ chargeable_now endpoint missing 402 insufficient-credits handler: ${path}`);
    failed++;
  }
  if (!body.includes("billing:")) {
    console.error(`✗ chargeable_now endpoint missing billing metadata in response: ${path}`);
    failed++;
  }
}

// Sanity-check: the deferred set must NOT silently start charging without
// being added to chargeable_now.
for (const path of NON_CHARGEABLE_OR_DEFERRED) {
  if (!existsSync(path)) continue;
  const body = readFileSync(path, "utf8");
  if (body.includes(NEEDLE)) {
    console.error(
      `✗ Endpoint ${path} calls ${NEEDLE} but is listed as deferred — promote it to chargeable_now.`,
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} endpoint-wiring failure(s).`);
  process.exit(1);
}
console.log(`✓ ${CHARGEABLE_NOW.length} chargeable_now endpoint(s) wired to ${NEEDLE}.`);
