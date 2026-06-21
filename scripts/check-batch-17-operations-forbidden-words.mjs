#!/usr/bin/env node
// Batch 17 guard — operations centre UI must never imply automatic approval
// or production-ready promotion outside the accepted readiness gate.
import fs from "node:fs";

const FILES = [
  "src/pages/admin/registry/operations/Centre.tsx",
  "src/pages/admin/registry/operations/Queue.tsx",
  "src/pages/admin/registry/operations/Risk.tsx",
  "src/pages/admin/registry/operations/Slas.tsx",
  "src/pages/admin/registry/operations/Readiness.tsx",
  "src/pages/admin/registry/operations/Audit.tsx",
];

const BANNED = [
  /auto[- ]?approve/i,
  /automatically approve/i,
  /auto[- ]?verify/i,
  /\bguaranteed\b/i,
];

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  for (const pat of BANNED) {
    if (pat.test(src)) {
      console.error(`[batch-17] forbidden wording ${pat} in ${f}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[batch-17] operations forbidden-words guard OK");
