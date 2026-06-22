#!/usr/bin/env node
// P-4 Point 4 — Artefact pricing TS↔Deno parity + invariant guard.
import { readFileSync } from "node:fs";

const BROWSER = "src/lib/registry-api-artefact-pricing.ts";
const DENO = "supabase/functions/_shared/registry-api-artefact-pricing.ts";

const b = readFileSync(BROWSER, "utf8");
const d = readFileSync(DENO, "utf8");

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error("✗", msg);
    failed++;
  } else {
    console.log("✓", msg);
  }
}

check(b === d, "Browser SSOT and Deno mirror are byte-identical");

// Hard-pinned invariants from David's confirmation + price book.
const pinned = [
  ['CREDIT_UNITS_PER_CREDIT = 100', /CREDIT_UNITS_PER_CREDIT\s*=\s*100/],
  ['USD_PER_CREDIT = 10', /USD_PER_CREDIT\s*=\s*10/],
  ['Basic POI = $10', /code:\s*"basic_poi"[^}]*usd_price:\s*10/],
  ['Counterparty Profile = $25', /code:\s*"counterparty_profile"[^}]*usd_price:\s*25/],
  ['Verified Counterparty = $100', /code:\s*"verified_counterparty"[^}]*usd_price:\s*100/],
  ['Basic WaD = $75', /code:\s*"basic_wad"[^}]*usd_price:\s*75/],
  ['Payment Evidence = $500', /code:\s*"payment_evidence"[^}]*usd_price:\s*500/],
  ['Counterparty Memory = $500', /code:\s*"counterparty_memory"[^}]*usd_price:\s*500/],
  ['Audit Trail = $500', /code:\s*"audit_trail"[^}]*usd_price:\s*500/],
  ['Bank-detail Confidence Record = $75', /code:\s*"bank_detail_confidence_record"[^}]*usd_price:\s*75/],
];
for (const [name, re] of pinned) check(re.test(b), `Pinned price present: ${name}`);

// Audit event SSOT coverage.
const requiredAuditEvents = [
  "api.token_burn.succeeded",
  "api.token_burn.insufficient_credits",
  "api.token_burn.skipped_sandbox",
  "api.token_burn.skipped_non_chargeable",
  "api.token_burn.skipped_no_result",
  "api.token_burn.skipped_failed_call",
  "api.token_burn.idempotent_replay",
  "api.token_burn.reversed",
  "api.token_burn.missing_price_fail_closed",
  "api.token_burn.variable_price_unresolved",
];
for (const ev of requiredAuditEvents) {
  check(b.includes(`"${ev}"`), `Audit event registered: ${ev}`);
}

// Non-chargeable reasons.
const nonChargeable = [
  "authentication","health_check","documentation","balance_check","sandbox",
  "failed_technical_call","unauthorised","revoked_key","invalid_scope",
  "malformed_request","no_result_no_artefact",
];
for (const r of nonChargeable) {
  check(b.includes(`"${r}"`), `Non-chargeable reason registered: ${r}`);
}

// Burn helper must use atomic_token_burn (no parallel engine).
const helper = readFileSync("supabase/functions/_shared/api-artefact-burn.ts", "utf8");
check(
  /\.rpc\("atomic_token_burn"/.test(helper),
  "Burn helper uses existing atomic_token_burn RPC",
);
check(
  /institutional_api_artefact_burn/.test(helper),
  "Burn helper tags ledger with reason category institutional_api_artefact_burn",
);
check(
  /http_status:\s*402/.test(helper),
  "Burn helper returns HTTP 402 on insufficient credits",
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll artefact-pricing parity checks passed.");
