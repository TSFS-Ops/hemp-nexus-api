#!/usr/bin/env node
/**
 * P010 drift checker.
 * Ensures `src/lib/stub-providers.ts` and
 * `supabase/functions/_shared/stub-providers.ts` declare the same
 * provider set, status values, forbidden words, audit names, and labels.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const browserPath = resolve("src/lib/stub-providers.ts");
const edgePath = resolve("supabase/functions/_shared/stub-providers.ts");

const PINS = [
  // provider set
  /key:\s*"cipc"/, /key:\s*"onfido"/, /key:\s*"dow_jones"/, /key:\s*"refinitiv"/,
  // status values
  /STUB_NOT_LIVE:\s*"stub_not_live"/,
  /NO_EXTERNAL_CHECK:\s*"no_external_check"/,
  /PROVIDER_NOT_CONNECTED:\s*"provider_not_connected"/,
  // forbidden words
  /"verified"/, /"cleared"/, /"passed"/, /"approved"/, /"screened"/, /"complete"/,
  // audit names
  /NOT_LIVE:\s*"stub_provider\.not_live"/,
  /BLOCKED:\s*"stub_provider\.blocked"/,
  /NO_EXTERNAL_CHECK:\s*"stub_provider\.no_external_check"/,
  // labels
  /Not live yet — no external provider check is performed\./,
  /This provider is not connected yet\. No real external verification, screening, or clearance is performed\./,
  // error code
  /STUB_PROVIDER_ERROR_CODE\s*=\s*"STUB_PROVIDER_NOT_LIVE"/,
];

const errors = [];
for (const file of [browserPath, edgePath]) {
  const src = readFileSync(file, "utf8");
  for (const re of PINS) {
    if (!re.test(src)) errors.push(`${file}: missing pin ${re}`);
  }
}

if (errors.length) {
  console.error("[check-stub-providers-parity] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`[check-stub-providers-parity] OK (${PINS.length} pins across 2 files)`);
