#!/usr/bin/env node
// Pin the claim-lifecycle webhook event list between the Deno SSOT and
// the frontend mirror so the two never drift.
import fs from "node:fs";

const a = fs.readFileSync("supabase/functions/_shared/claim-lifecycle-webhooks.ts", "utf8");
const b = fs.readFileSync("src/lib/claim-lifecycle-webhooks.ts", "utf8");

const extract = (s) => {
  const m = s.match(/CLAIM_LIFECYCLE_WEBHOOK_EVENTS\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("array not found");
  return m[1].split(",").map(x => x.trim().replace(/["']/g, "")).filter(Boolean).sort();
};
const da = extract(a), db = extract(b);
if (JSON.stringify(da) !== JSON.stringify(db)) {
  console.error("Claim lifecycle webhook event list drift:");
  console.error(" Deno:", da);
  console.error(" Web :", db);
  process.exit(1);
}
console.log(`claim-lifecycle-webhook-parity OK (${da.length} events)`);
