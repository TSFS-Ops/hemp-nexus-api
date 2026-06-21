#!/usr/bin/env node
/**
 * Batch 13B — Bank-detail UI must never select raw bank-detail fields.
 *
 * The B13 user-facing and admin pages must only read masked / status /
 * risk columns from `registry_bank_detail_submissions`. They must never
 * SELECT the obfuscated `enc_*` columns; only the elevated unmask edge
 * function may decode those.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  "src/pages/registry/BankDetailSubmit.tsx",
  "src/pages/registry/BankDetailStatus.tsx",
  "src/pages/admin/registry/BankDetailReview.tsx",
];

const FORBIDDEN_COLUMNS = [
  "enc_account_holder_name",
  "enc_bank_name",
  "enc_account_number",
  "enc_iban",
  "enc_swift_bic",
  "enc_branch_code",
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const col of FORBIDDEN_COLUMNS) {
    if (src.includes(col)) {
      console.error(`✗ ${f} references raw obfuscated column "${col}" — must not be read from UI`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`✓ Batch 13B UI no-raw-bank-leak check passed (${TARGETS.length} files)`);
