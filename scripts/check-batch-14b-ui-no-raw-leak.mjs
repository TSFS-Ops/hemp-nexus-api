#!/usr/bin/env node
/**
 * Batch 14B — Verification UI must never SELECT raw encrypted bank columns.
 * Raw access is restricted to the Batch 13B unmask flow (elevated, reasoned,
 * audited) and is NOT permitted on any B14B verification surface.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  "src/pages/admin/registry/BankVerificationReview.tsx",
  "src/components/registry/BankVerificationPublicStatus.tsx",
  "src/lib/registry-bank-verification-ui.ts",
];

const FORBIDDEN = [
  /\benc_account_number\b/,
  /\benc_iban\b/,
  /\benc_swift\b/,
  /\benc_branch_code\b/,
  /\benc_account_holder\b/,
  /\benc_bank_name\b/,
  /provider_payload/i, // raw provider payloads must not be rendered here
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(src)) {
      console.error(`✗ ${f} references forbidden raw column/payload matching ${re}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`✓ Batch 14B UI no-raw-leak check passed (${TARGETS.length} files)`);
