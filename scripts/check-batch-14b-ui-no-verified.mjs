#!/usr/bin/env node
/**
 * Batch 14B — Verification UI must never imply verified for non-final states.
 *
 * Scans the B14B UI surfaces (admin queue/detail, claimant status component,
 * UI SSOT) for forbidden verification wording. The conservative
 * "Not verified" badge and SSOT public labels are allowed.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  "src/pages/admin/registry/BankVerificationReview.tsx",
  "src/components/registry/BankVerificationPublicStatus.tsx",
  "src/lib/registry-bank-verification-ui.ts",
];

const FORBIDDEN = [
  /captured\s+but\s+verified/i,
  /manual(ly)?\s+provider[-\s]verified/i,
  /provider\s+verified\s+by\s+izenzo\s+automatically/i,
  /auto[-\s]?verified/i,
  /live\s+provider\s+check\s+completed/i,
  /(?<!not\s)production[-\s]ready/i,
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(src)) {
      console.error(`✗ ${f} contains forbidden B14B wording matching ${re}`);
      failed = true;
    }
  }
  // Ensure the conservative "Not verified" badge constant is referenced
  // somewhere in the admin queue + detail page.
  if (f.endsWith("BankVerificationReview.tsx") && !/REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE/.test(src)) {
    console.error(`✗ ${f} must reference REGISTRY_BANK_VERIFICATION_UI_NOT_VERIFIED_BADGE`);
    failed = true;
  }
  // Provider simulation surfaces must show the canonical test-only label.
  if (f.endsWith("BankVerificationReview.tsx") && !/REGISTRY_BANK_VERIFICATION_UI_PROVIDER_SIMULATION_LABEL/.test(src)) {
    console.error(`✗ ${f} must reference the provider simulation test-only label`);
    failed = true;
  }
  // Manual verification surfaces must reference the canonical acknowledgement.
  if (f.endsWith("BankVerificationReview.tsx") && !/REGISTRY_BANK_VERIFICATION_UI_MANUAL_ACK_TEXT/.test(src)) {
    console.error(`✗ ${f} must reference the manual verification acknowledgement`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`✓ Batch 14B UI no-verified wording check passed (${TARGETS.length} files)`);
