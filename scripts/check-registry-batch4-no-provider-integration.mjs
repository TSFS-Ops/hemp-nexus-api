#!/usr/bin/env node
/**
 * Batch 4 — block external bank/IDV provider integration AND the institutional
 * API facade inside Batch 4 edge functions and pages.
 */
import { readFileSync, readdirSync } from "node:fs";

const FORBIDDEN = [
  "cipc", "onfido", "globaldatabase", "b2bhint", "dowjones", "dow-jones",
  "refinitiv", "payfast", "yodlee", "plaid", "tink", "trulioo",
];
const FILES = [
  ...readdirSync("supabase/functions").filter((d) => d.startsWith("registry-authority-") || d.startsWith("registry-bank-detail-")).map((d) => `supabase/functions/${d}/index.ts`),
  "supabase/functions/_shared/registry-authority.ts",
  "supabase/functions/_shared/registry-bank-details.ts",
  "src/lib/registry-authority.ts",
  "src/lib/registry-bank-details.ts",
  "src/pages/registry/Authority.tsx",
  "src/pages/registry/BankDetails.tsx",
  "src/pages/admin/registry/Authority.tsx",
  "src/pages/admin/registry/BankDetails.tsx",
];

let failed = false;
for (const f of FILES) {
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const tok of FORBIDDEN) {
    if (src.includes(tok)) { console.error(`✗ ${f} references forbidden Batch 4 provider "${tok}"`); failed = true; }
  }
  // No institutional API facade endpoints in Batch 4.
  if (src.includes("/v1/institutional/") || src.includes("institutional_api_v1")) {
    console.error(`✗ ${f} references Batch-4-out-of-scope institutional API surface`); failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ Batch 4 provider/institutional-API isolation OK");
