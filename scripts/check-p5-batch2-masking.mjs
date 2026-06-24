#!/usr/bin/env node
// P-5 Batch 2 — masking guard: funder + counterparty surfaces must import or
// reference the masking helper, since they render sensitive fields.
import { readFileSync } from "node:fs";
const NEED_MASK = [
  "src/pages/funder/p5-batch2/FunderEvidencePack.tsx",
  "src/pages/registry/p5-batch2/CounterpartyEvidenceChecklist.tsx",
  "src/pages/admin/p5-batch2/components/MaskedField.tsx",
];
let bad = [];
for (const f of NEED_MASK) {
  const txt = readFileSync(f, "utf8");
  if (!/mask|Masked/.test(txt)) bad.push(`${f}: no masking applied`);
}
if (bad.length) { console.error("masking:\n" + bad.join("\n")); process.exit(1); }
console.log("masking: OK");
