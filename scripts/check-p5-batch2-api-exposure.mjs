#!/usr/bin/env node
// P-5 Batch 2 — API exposure guard: API-customer surface mirrors only
// the safe summary shape and must not reference internal-only columns.
import { readFileSync } from "node:fs";
const FORBIDDEN = ["fraud_flag", "reviewer_note_internal", "provider_raw_response", "passport_number", "bank_account_number"];
const FILES = ["src/pages/registry/p5-batch2/api-customer/ApiCustomerSummary.tsx"];
let bad = [];
for (const f of FILES) {
  const txt = readFileSync(f, "utf8");
  for (const k of FORBIDDEN) if (txt.includes(k)) bad.push(`${f}: leaks ${k}`);
}
if (bad.length) { console.error("api-exposure:\n" + bad.join("\n")); process.exit(1); }
console.log("api-exposure: OK");
