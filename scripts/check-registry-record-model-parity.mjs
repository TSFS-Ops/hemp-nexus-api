#!/usr/bin/env node
// Pin the Batch 8 record/search model between Deno SSOT and frontend mirror.
import fs from "node:fs";

function extract(src) {
  const grab = (re) => {
    const m = src.match(re);
    if (!m) return null;
    return m[1]
      .split(",")
      .map(x => x.trim().replace(/["']/g, ""))
      .filter(Boolean)
      .sort();
  };
  return {
    public:    grab(/PUBLIC_SEARCHABLE_FIELDS\s*=\s*\[([^\]]+)\]/),
    adminOnly: grab(/ADMIN_ONLY_SEARCHABLE_FIELDS\s*=\s*\[([^\]]+)\]/),
    forbidden: grab(/FORBIDDEN_PUBLIC_FIELDS\s*=\s*\[([^\]]+)\]/),
    events:    grab(/REGISTRY_RECORD_AUDIT_EVENT_NAMES\s*=\s*\[([^\]]+)\]/),
    states:    grab(/REGISTRY_RECORD_READINESS_STATES\s*=\s*\[([^\]]+)\]/),
  };
}

const a = extract(fs.readFileSync("supabase/functions/_shared/registry-record-model.ts", "utf8"));
const b = extract(fs.readFileSync("src/lib/registry-record-model.ts", "utf8"));

let failed = false;
for (const k of Object.keys(a)) {
  if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
    console.error(`[batch8-parity] drift in ${k}`);
    console.error("  deno:", a[k]);
    console.error("  web :", b[k]);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("[batch8-parity] OK");
