#!/usr/bin/env node
/** Batch 19B — sample-only API contract guard.
 *  The SSOT must declare:
 *    production_api: "excluded"
 *    sandbox_verified_by_izenzo: false
 *    payment_status_usable_verified: false
 *  And the five attached records must be present. */
import fs from "node:fs";

const SSOT = "src/lib/registry-client-decisions-19b.ts";
const SSOT19A = "src/lib/registry-client-decisions-19a.ts";
const src = fs.readFileSync(SSOT, "utf8");
const src19a = fs.readFileSync(SSOT19A, "utf8");

const must = [
  /production_api:\s*"excluded"/,
  /sandbox_readiness_state:\s*"sample_only"/,
  /sandbox_verified_by_izenzo:\s*false/,
  /payment_status_usable_verified:\s*false/,
];
let bad = 0;
for (const re of must) {
  if (!re.test(src)) {
    console.error(`[batch-19b] sample-only API contract missing: ${re}`);
    bad++;
  }
}
const records = [
  "bullion_bathrooms_nigeria",
  "dangote_fertiliser_limited",
  "harith_holdings",
  "laurium_capital",
  "starfair_162",
];
for (const r of records) {
  if (!src19a.includes(r)) {
    console.error(`[batch-19b] sample-only record missing in 19A SSOT: ${r}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log("[batch-19b] sample-only API contract ok");
