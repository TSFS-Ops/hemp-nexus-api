#!/usr/bin/env node
/** Batch 19A — sample_only lock guard.
 *  Ensures the five client-attached records remain pinned to sample_only in
 *  the SSOT and are never referenced as production-ready in seed/demo code. */
import fs from "node:fs";
import path from "node:path";

const SSOT = "src/lib/registry-client-decisions-19a.ts";
const src = fs.readFileSync(SSOT, "utf8");
const REQUIRED = [
  "bullion_bathrooms_nigeria",
  "dangote_fertiliser_limited",
  "harith_holdings",
  "laurium_capital",
  "starfair_162",
];
const missing = REQUIRED.filter((r) => !src.includes(r));
if (missing.length) {
  console.error(`[batch-19a] sample_only registry missing: ${missing.join(", ")}`);
  process.exit(1);
}

// No production_ready references in seed/demo for the five slugs.
const SCAN_DIRS = ["src", "supabase/functions", "docs"];
const PROD_RE = /production[_\s-]ready/i;
let bad = 0;
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|md|sql|json)$/.test(e.name)) yield p;
  }
}
for (const root of SCAN_DIRS) {
  for (const f of walk(root)) {
    const s = fs.readFileSync(f, "utf8");
    for (const slug of REQUIRED) {
      if (s.includes(slug) && PROD_RE.test(s)) {
        // Allow if the file is the SSOT or evidence docs explicitly stating "not production_ready"
        const lines = s.split("\n");
        const idx = lines.findIndex((l) => l.includes(slug));
        const nearby = lines.slice(Math.max(0, idx - 3), idx + 4).join(" ");
        if (/not\s+production[_\s-]ready|excluded.*production/i.test(nearby)) continue;
        console.error(
          `[batch-19a] ${f} references sample slug '${slug}' near 'production_ready' — must be excluded`,
        );
        bad++;
      }
    }
  }
}
if (bad) process.exit(1);
console.log("[batch-19a] sample_only lock guard ok");
