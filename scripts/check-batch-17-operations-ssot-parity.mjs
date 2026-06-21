#!/usr/bin/env node
// Batch 17 guard — SSOT parity between the TS (browser) and Deno (edge)
// mirrors for the registry operations centre.
import fs from "node:fs";

const TS = fs.readFileSync("src/lib/registry-operations-centre-ssot.ts", "utf8");
const DENO = fs.readFileSync("supabase/functions/_shared/registry-operations-centre.ts", "utf8");

const ARRAYS = [
  "REGISTRY_OPS_WORK_ITEM_TYPES",
  "REGISTRY_OPS_SOURCE_MODULES",
  "REGISTRY_OPS_SLA_STATES",
  "REGISTRY_OPS_SEVERITIES",
  "REGISTRY_OPS_RISK_CATEGORIES",
  "REGISTRY_OPS_TILE_CODES",
  "REGISTRY_OPS_BLOCKED_REASONS",
  "REGISTRY_OPS_FORBIDDEN_WORDS",
  "REGISTRY_OPS_FORBIDDEN_RAW_FIELDS",
];

function extract(src, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`);
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean).sort().join("|");
}

let failed = false;
for (const name of ARRAYS) {
  const a = extract(TS, name);
  const b = extract(DENO, name);
  if (a == null || b == null) { console.error(`[batch-17] ${name}: missing in TS or Deno mirror`); failed = true; continue; }
  if (a !== b) {
    console.error(`[batch-17] ${name}: TS ↔ Deno mismatch`);
    console.error(`  TS:   ${a}`);
    console.error(`  Deno: ${b}`);
    failed = true;
  }
}

// Default SLA hours parity (object) — check keys at least.
const keysTs = (TS.match(/REGISTRY_OPS_DEFAULT_SLA_HOURS[\s\S]*?\{([\s\S]*?)\}/) || [])[1] || "";
const keysDeno = (DENO.match(/REGISTRY_OPS_DEFAULT_SLA_HOURS[\s\S]*?\{([\s\S]*?)\}/) || [])[1] || "";
const k = (s) => [...s.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort().join("|");
if (k(keysTs) !== k(keysDeno)) {
  console.error("[batch-17] REGISTRY_OPS_DEFAULT_SLA_HOURS keys mismatch");
  failed = true;
}

if (failed) process.exit(1);
console.log("[batch-17] operations SSOT parity OK");
