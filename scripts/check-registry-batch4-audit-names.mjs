#!/usr/bin/env node
/**
 * Batch 4 — every authority and bank-detail audit name must be emitted by
 * at least one Batch 4 edge function.
 */
import { readFileSync, readdirSync } from "node:fs";

function extract(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  return m ? Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]) : [];
}

const auth = extract(readFileSync("src/lib/registry-authority.ts", "utf8"), "REGISTRY_AUTHORITY_AUDIT_EVENT_NAMES");
const bank = extract(readFileSync("src/lib/registry-bank-details.ts", "utf8"), "REGISTRY_BANK_DETAIL_AUDIT_EVENT_NAMES");

const dirs = readdirSync("supabase/functions").filter((d) =>
  d.startsWith("registry-authority-") || d.startsWith("registry-bank-detail-"),
);
const sources = dirs.map((d) => readFileSync(`supabase/functions/${d}/index.ts`, "utf8")).join("\n");

let failed = false;
for (const n of [...auth, ...bank]) {
  if (!sources.includes(`"${n}"`)) {
    console.error(`✗ audit name "${n}" not emitted by any Batch 4 edge function`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ Batch 4 audit-name coverage OK");
