#!/usr/bin/env node
// Batch 16 guard — non-final / expired / disputed / revoked verification
// states must never render as "Verified" in company portal pages.
import fs from "node:fs";

const PAGES = [
  "src/pages/registry/MyCompanies.tsx",
  "src/pages/registry/MyCompanyDetail.tsx",
];

// Forbid the hardcoded literal "Verified" being applied to a status
// without going through safeVerificationLabel.
let failed = false;
for (const f of PAGES) {
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("safeVerificationLabel")) {
    console.error(`[batch-16] ${f} does not use safeVerificationLabel`);
    failed = true;
  }
  // Hardcoded \"Verified\" string outside the SSOT helper is banned.
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (/['"`]Verified['"`]/.test(l) && !l.includes("safeVerificationLabel")) {
      console.error(`[batch-16] hardcoded "Verified" literal at ${f}:${i + 1}`);
      failed = true;
    }
  });
}
if (failed) process.exit(1);
console.log("[batch-16] portal verification-wording guard OK");
