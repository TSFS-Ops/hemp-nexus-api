#!/usr/bin/env node
/**
 * Batch 3 — Public registry surfaces must NEVER reference raw bank-detail
 * field names. Only the public bank-detail STATUS LABELS are permitted on
 * search / profile / claim surfaces.
 *
 * Forbidden tokens in public registry components/pages:
 *   account_number, sort_code, iban, swift_bic, routing_number, bank_account
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "account_number",
  "sort_code",
  "iban",
  "swift_bic",
  "routing_number",
  "bank_account",
];

const SCAN = [
  "src/pages/registry",
  "src/components/registry",
  "supabase/functions/registry-company-search",
  "supabase/functions/registry-company-profile",
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.(tsx?|ts)$/.test(name)) files.push(p);
  }
  return files;
}

let failed = false;
// Batch 4 — the consent-gated capture surfaces (the only place users can ever
// type raw bank fields) are exempted from the leakage scan because they ARE
// the controlled capture form. They never render raw fields back to users on
// subsequent reads; only masked_* columns are shown.
const EXEMPT = new Set([
  "src/pages/registry/BankDetails.tsx",
]);
for (const d of SCAN) {
  let files;
  try { files = walk(d); } catch { continue; }
  for (const f of files) {
    if (f.includes(".test.")) continue;
    if (EXEMPT.has(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const tok of FORBIDDEN) {
      const re = new RegExp(`\\b${tok}\\b`, "i");
      if (re.test(src)) {
        console.error(`✗ public registry surface ${f} references forbidden raw bank token "${tok}"`);
        failed = true;
      }
    }
  }
}

if (failed) process.exit(1);
console.log("✓ no raw bank-detail leakage on public registry surfaces");
