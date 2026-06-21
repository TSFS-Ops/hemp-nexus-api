#!/usr/bin/env node
// Batch 17 guard — every link emitted by the operations centre pages must
// target an accepted /admin/registry route (route-safe).
import fs from "node:fs";

const FILES = [
  "src/pages/admin/registry/operations/Centre.tsx",
  "src/pages/admin/registry/operations/Queue.tsx",
  "src/pages/admin/registry/operations/Risk.tsx",
  "src/pages/admin/registry/operations/Slas.tsx",
  "src/pages/admin/registry/operations/Readiness.tsx",
  "src/pages/admin/registry/operations/Audit.tsx",
];

const PREFIX_OK = /^\/admin\/registry(\/|$|\?)/;
const LITERAL_LINK = /<Link[^>]*\bto=\{?"([^"]+)"\}?/g;

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(LITERAL_LINK)) {
    const href = m[1];
    if (href.startsWith("http") || href.startsWith("mailto:")) {
      console.error(`[batch-17] external link not allowed in operations centre: ${href} (${f})`);
      failed = true;
      continue;
    }
    if (!PREFIX_OK.test(href)) {
      console.error(`[batch-17] off-namespace link in ${f}: ${href}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[batch-17] operations route-safe guard OK");
