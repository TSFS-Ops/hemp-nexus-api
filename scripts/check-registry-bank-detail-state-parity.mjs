#!/usr/bin/env node
/**
 * Batch 4 — TS ↔ Deno parity guard for bank-detail SSOT.
 */
import { readFileSync } from "node:fs";
const ts = readFileSync("src/lib/registry-bank-details.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-bank-details.ts", "utf8");

function extract(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}
const names = [
  "REGISTRY_BANK_DETAIL_STATES",
  "REGISTRY_BANK_DETAIL_CONSENT_SCOPES",
  "REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES",
];
let failed = false;
for (const n of names) {
  const a = extract(ts, n), b = extract(deno, n);
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${n} drift`); failed = true; }
}
if (failed) process.exit(1);
console.log("✓ registry-bank-details TS ↔ Deno parity OK");
