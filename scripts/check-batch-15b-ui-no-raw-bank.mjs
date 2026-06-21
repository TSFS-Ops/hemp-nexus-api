#!/usr/bin/env node
/**
 * Batch 15B guard — UI must not surface raw or masked bank fields.
 *
 * Scans the Batch 15B admin UI files for any reference to raw bank fields
 * (account_number, sort_code, iban, swift_bic, routing_number, branch_code,
 * bank_code, account_holder) or masked bank fields (account_number_masked,
 * iban_masked) outside of the SSOT forbidden-field allowlist constant.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "src/pages/admin/registry/ApiClientsList.tsx",
  "src/pages/admin/registry/ApiClientDetail.tsx",
  "src/pages/admin/registry/ApiUsage.tsx",
  "src/pages/admin/registry/ApiTestConsole.tsx",
  "src/lib/registry-api-hardening-ui.ts",
];

const FORBIDDEN = [
  "account_number",
  "sort_code",
  "swift_bic",
  "routing_number",
  "branch_code",
  "bank_code",
  "account_holder",
  "iban",
  "account_number_masked",
  "iban_masked",
];

// Allow these contexts (token mentions inside safety copy / SSOT lists).
const ALLOWED_CONTEXTS = [
  "FORBIDDEN_RESPONSE_FIELDS",
  "rawBankProhibition",
  "Raw bank-detail",
  "Raw bank account numbers",
];

let failed = false;
for (const f of FILES) {
  const full = path.join(process.cwd(), f);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  for (const token of FORBIDDEN) {
    const re = new RegExp(`\\b${token}\\b`, "i");
    if (!re.test(text)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      if (ALLOWED_CONTEXTS.some((ctx) => line.includes(ctx))) return;
      console.error(`✗ ${f}:${i + 1} — forbidden raw/masked bank token "${token}"`);
      failed = true;
    });
  }
}

if (failed) {
  console.error("Batch 15B UI raw-bank guard FAILED.");
  process.exit(1);
}
console.log("✓ Batch 15B UI raw/masked bank guard OK");
