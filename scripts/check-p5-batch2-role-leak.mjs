#!/usr/bin/env node
// P-5 Batch 2 — role leak guard: funder + api-customer surfaces must not
// contain admin-only token strings.
import { readFileSync } from "node:fs";
const FILES = [
  "src/pages/funder/p5-batch2/FunderEvidencePack.tsx",
  "src/pages/registry/p5-batch2/api-customer/ApiCustomerSummary.tsx",
];
const FORBIDDEN = ["reviewer_note_internal", "fraud_flag", "admin_audit_logs"];
let bad = [];
for (const f of FILES) {
  const txt = readFileSync(f, "utf8");
  for (const k of FORBIDDEN) if (txt.includes(k)) bad.push(`${f}: ${k}`);
}
if (bad.length) { console.error("role-leak:\n" + bad.join("\n")); process.exit(1); }
console.log("role-leak: OK");
