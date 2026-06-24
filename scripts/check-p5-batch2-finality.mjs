#!/usr/bin/env node
// P-5 Batch 2 — finality guard: finality-bridge consumes blocker severities
// from readiness-bridge and does not write to any business row.
import { readFileSync } from "node:fs";
const t = readFileSync("src/lib/p5-batch2/finality-bridge.ts", "utf8");
if (!/evaluateP5B2FinalityGuard/.test(t)) { console.error("finality: missing exported guard"); process.exit(1); }
if (/from ["']@\/integrations\/supabase/.test(t)) { console.error("finality: must not import supabase client"); process.exit(1); }
if (/insert|update|delete/i.test(t.replace(/\/\/.*$/gm, ""))) {
  // pure module — should not contain DB verbs in source
  console.error("finality: contains DB mutation verbs"); process.exit(1);
}
console.log("finality: OK");
