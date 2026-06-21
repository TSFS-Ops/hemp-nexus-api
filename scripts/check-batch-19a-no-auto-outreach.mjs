#!/usr/bin/env node
/** Batch 19A — no automatic outreach + SMS/WhatsApp disabled in Phase 1. */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "supabase/functions"];
const BAD = [
  /\bauto[_\s-]?dial\b/i,
  /\bauto[_\s-]?send[_\s-]?sms\b/i,
  /\bauto[_\s-]?send[_\s-]?whatsapp\b/i,
  /\bwhatsapp[_\s-]?business[_\s-]?send\b/i,
  /\bsms[_\s-]?send[_\s-]?live\b/i,
];
const ALLOW = new Set([
  "scripts/check-batch-19a-no-auto-outreach.mjs",
  "src/lib/registry-client-decisions-19a.ts",
]);
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}
let bad = 0;
for (const root of ROOTS) {
  for (const f of walk(root)) {
    if (ALLOW.has(f)) continue;
    const s = fs.readFileSync(f, "utf8");
    for (const re of BAD) {
      if (re.test(s)) {
        console.error(`[batch-19a] disallowed outreach token in ${f}: ${re}`);
        bad++;
      }
    }
  }
}
if (bad) process.exit(1);
console.log("[batch-19a] no-auto-outreach guard ok");
