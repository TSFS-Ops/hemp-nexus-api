#!/usr/bin/env node
// DEC-007 / PAY-009 — forbid ledger deletes / POI / WaD / execution / audit
// history mutation from refund + dispute code surfaces.
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_PATTERNS = [
  /delete\s+from\s+token_ledger/i,
  /\.from\(\s*['"]token_ledger['"]\s*\)\s*\.delete\(/,
  /\.from\(\s*['"]audit_logs['"]\s*\)\s*\.delete\(/,
  /\.from\(\s*['"]matches['"]\s*\)\s*\.delete\(/,
  /\.from\(\s*['"]poi['"]\s*\)\s*\.delete\(/,
  /\.from\(\s*['"]wads['"]\s*\)\s*\.delete\(/,
];

const SCOPED = [
  "supabase/functions/refund-request",
  "supabase/functions/admin-refund-approve",
  "supabase/functions/admin-refund-decline",
  "supabase/functions/admin-payment-dispute-record",
  "supabase/functions/admin-payment-dispute-resolve-won",
  "supabase/functions/admin-payment-dispute-resolve-lost",
  "supabase/functions/admin-billing-hold-apply",
  "supabase/functions/admin-billing-hold-release",
  "supabase/functions/_shared/billing-hold-guard.ts",
];

let failed = false;
function scan(p){
  const s = fs.readFileSync(p, "utf8");
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(s)) {
      console.error(`[check-dec-007-pay-009-no-ledger-delete] ${p} matches ${re}`);
      failed = true;
    }
  }
}
for (const root of SCOPED) {
  if (!fs.existsSync(root)) continue;
  const st = fs.statSync(root);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(root)) {
      const p = path.join(root, f);
      if (fs.statSync(p).isFile() && /\.ts$/.test(p)) scan(p);
    }
  } else scan(root);
}
if (failed) process.exit(1);
console.log("[check-dec-007-pay-009-no-ledger-delete] ok — no ledger/audit/POI/WaD deletes in DEC-007/PAY-009 surfaces");
