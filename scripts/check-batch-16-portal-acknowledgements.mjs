#!/usr/bin/env node
// Batch 16 guard — correction, dispute and revocation forms must
// include the canonical acknowledgement text from the SSOT.
import fs from "node:fs";

const checks = [
  ["src/pages/registry/MyCompanyCorrections.tsx", "PORTAL_CORRECTION_ACK"],
  ["src/pages/registry/MyCompanyDisputes.tsx", "PORTAL_DISPUTE_ACK"],
  ["src/pages/registry/MyCompanyRevocations.tsx", "PORTAL_REVOCATION_BANK_ACK"],
  ["src/pages/registry/MyCompanyRevocations.tsx", "PORTAL_REVOCATION_AUTHORITY_ACK"],
];
let failed = false;
for (const [file, token] of checks) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(token)) {
    console.error(`[batch-16] ${file} missing acknowledgement ${token}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("[batch-16] portal acknowledgement guard OK");
