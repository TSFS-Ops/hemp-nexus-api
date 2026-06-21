#!/usr/bin/env node
/** Batch 19B — docs presence + client-decision scenarios in UAT/demo packs. */
import fs from "node:fs";

const FILES = [
  "docs/registry/uat-scenarios.md",
  "docs/registry/demo-walkthrough.md",
  "docs/registry/client-safe-limitations.md",
  "docs/registry/release-gate-matrix.md",
  "evidence/batch-19b-client-decision-ui-api-uat-alignment/README.md",
  "evidence/registry-evidence-index/README.md",
];
let bad = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) {
    console.error(`[batch-19b] missing required doc: ${f}`);
    bad++;
  }
}
const uat = fs.readFileSync("docs/registry/uat-scenarios.md", "utf8");
const needles = [
  "sample_only",
  "claim_approved_limited",
  "officer-name",
  "do-not-contact",
  "SMS",
  "WhatsApp",
];
for (const n of needles) {
  if (!uat.toLowerCase().includes(n.toLowerCase())) {
    console.error(`[batch-19b] uat-scenarios.md missing client-decision needle: ${n}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log("[batch-19b] docs present + client-decision scenarios ok");
