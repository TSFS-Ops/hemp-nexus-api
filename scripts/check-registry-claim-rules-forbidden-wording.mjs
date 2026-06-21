#!/usr/bin/env node
// Batch 7 — Forbidden wording on imported_unverified / claim_interest / new-company
// shell surfaces. Public surfaces must NEVER describe these as verified,
// production-ready, guaranteed, live, or institutionally usable.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "is verified",
  "production-ready",
  "production ready",
  "guaranteed accurate",
  "institutionally usable",
  "fully verified",
];

const PUBLIC_SURFACES = [
  "src/pages/registry",
  "src/pages/admin/registry/NewCompanyRequests.tsx",
  "src/pages/admin/registry/CorrectionRequests.tsx",
  "src/pages/admin/registry/ClaimConflicts.tsx",
];

function walk(p) {
  const out = [];
  try {
    const s = statSync(p);
    if (s.isFile()) { out.push(p); return out; }
    for (const f of readdirSync(p)) out.push(...walk(join(p, f)));
  } catch { /* missing */ }
  return out;
}

let failed = false;
for (const root of PUBLIC_SURFACES) {
  for (const file of walk(root)) {
    if (!/\.tsx?$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const phrase of FORBIDDEN) {
      // allow if appearing inside a string-literal guard array (this file references rules)
      if (src.includes(phrase)) {
        // tolerate audit/wording constants on the SSOT itself
        if (file.includes("registry-claim-rules.ts")) continue;
        console.error(`[batch7-wording] forbidden phrase "${phrase}" in ${file}`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("[batch7-wording] OK");
