#!/usr/bin/env node
// P-5 Batch 2 — masking guard: third-party-PII surfaces (funder pack +
// admin MaskedField component) must apply masking by default. Counterparty's
// own-evidence surface is exempt because it only renders the viewer's own
// data.
import { readFileSync } from "node:fs";
const NEED_MASK = [
  "src/pages/funder/p5-batch2/FunderEvidencePack.tsx",
  "src/pages/admin/p5-batch2/components/MaskedField.tsx",
];
let bad = [];
for (const f of NEED_MASK) {
  const txt = readFileSync(f, "utf8");
  if (!/mask|Mask/.test(txt)) bad.push(`${f}: no masking applied`);
}
if (bad.length) { console.error("masking:\n" + bad.join("\n")); process.exit(1); }
console.log("masking: OK");
