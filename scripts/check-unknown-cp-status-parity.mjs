#!/usr/bin/env node
/**
 * P012 — Verifies that the user_facing_status CHECK constraint in the
 * P012 migration matches the TS SSOT enum exactly.
 */
import { readFileSync, readdirSync } from "node:fs";

const tsSrc = readFileSync("src/lib/unknown-cp-timeline.ts", "utf8");
const m = tsSrc.match(/UNKNOWN_CP_STATUS_ORDER\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (!m) { console.error("Cannot extract TS enum"); process.exit(1); }
const tsEnum = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]).sort();

const migrations = readdirSync("supabase/migrations").sort().reverse();
let dbEnum = null;
for (const f of migrations) {
  const src = readFileSync(`supabase/migrations/${f}`, "utf8");
  if (src.includes("unknown_cp_case_overlays") && src.includes("user_facing_status")) {
    const cm = src.match(/user_facing_status\s+text[^(]*CHECK\s*\(\s*user_facing_status\s+IN\s*\(([\s\S]*?)\)\s*\)/);
    if (cm) {
      dbEnum = Array.from(cm[1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort();
      break;
    }
  }
}
if (!dbEnum) { console.error("Cannot find user_facing_status CHECK constraint"); process.exit(1); }

if (JSON.stringify(tsEnum) !== JSON.stringify(dbEnum)) {
  console.error("✗ user_facing_status drift between TS SSOT and DB CHECK");
  console.error("  TS:  ", tsEnum);
  console.error("  DB:  ", dbEnum);
  process.exit(1);
}
console.log("✓ unknown-cp user_facing_status TS ↔ DB parity OK");
