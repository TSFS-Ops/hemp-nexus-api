#!/usr/bin/env node
/**
 * P012 — Verifies parity of audit event names + status enum between the
 * TS SSOT (src/lib/unknown-cp-timeline.ts) and the Deno mirror
 * (supabase/functions/_shared/unknown-cp-timeline.ts).
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/unknown-cp-timeline.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/unknown-cp-timeline.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  ["UNKNOWN_CP_STATUS_ORDER"],
  ["UNKNOWN_CP_AUDIT_EVENT_NAMES"],
];

let failed = false;
for (const [name] of checks) {
  const a = extractArray(ts, name);
  const b = extractArray(deno, name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${name} drift between TS and Deno SSOT`);
    console.error("  TS:  ", a);
    console.error("  Deno:", b);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ unknown-cp audit names + status enum parity OK");
