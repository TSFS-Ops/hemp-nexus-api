#!/usr/bin/env node
// Forbid the verified / production-ready wording in registry public surfaces
// for Batch 8 — imported_unverified must remain the only readiness label
// shown without an explicit upgrade in a later batch.
import fs from "node:fs";
import path from "node:path";

const SCAN = ["src/pages/registry", "src/components/registry"];
const FORBIDDEN = [
  /\bindependently\s+verified\s+by\s+Izenzo\s*[.,]?\s*This\s+record\s+is/i, // false combo
  /\bproduction[-_ ]?ready\b/i,
  /\binstitutionally\s+usable\b/i,
];
// Allow the negative phrasing ("Not independently verified by Izenzo") which
// is part of the required disclaimer.
const ALLOW = [
  /not\s+independently\s+verified\s+by\s+izenzo/i,
  /has\s+not\s+yet\s+been\s+independently\s+verified/i,
  /unless\s+the\s+profile\s+status\s+says\s+verified/i,
];

let failed = false;
function walk(p) {
  if (!fs.existsSync(p)) return;
  for (const f of fs.readdirSync(p)) {
    const fp = path.join(p, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp);
    else if (/\.(tsx?|jsx?)$/.test(f)) {
      const src = fs.readFileSync(fp, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(src) && !ALLOW.some(a => a.test(src))) {
          console.error(`[batch8-wording] ${fp}: forbidden phrase ${re}`);
          failed = true;
        }
      }
    }
  }
}
SCAN.forEach(walk);
if (failed) process.exit(1);
console.log("[batch8-wording] OK");
