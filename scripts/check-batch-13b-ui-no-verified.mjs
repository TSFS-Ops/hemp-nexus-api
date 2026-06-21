#!/usr/bin/env node
/**
 * Batch 13B — Bank-detail UI must never imply verification.
 *
 * Scans the new B13 UI surfaces and the UI copy SSOT for forbidden
 * verification wording. The Batch 4 captured-not-verified strings are
 * allowed because they explicitly state the negative.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  "src/pages/registry/BankDetailSubmit.tsx",
  "src/pages/registry/BankDetailStatus.tsx",
  "src/pages/admin/registry/BankDetailReview.tsx",
  "src/lib/registry-bank-details-b13-ui.ts",
];

const FORBIDDEN = [
  /bank\s+details\s+verified/i,
  /verified\s+bank\s+(account|details)/i,
  /institutionally\s+usable/i,
  /production[-\s]ready/i,
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(src)) {
      console.error(`✗ ${f} contains forbidden B13 UI wording matching ${re}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`✓ Batch 13B UI no-verified wording check passed (${TARGETS.length} files)`);
