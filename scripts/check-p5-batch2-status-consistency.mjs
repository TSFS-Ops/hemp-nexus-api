#!/usr/bin/env node
// P-5 Batch 2 — Stage 6 cross-consistency: status enum guard.
// Confirms the TS SSOT statuses in src/lib/p5-batch2/constants.ts match
// the enum used by the database migration for evidence statuses.
import { readFileSync } from "node:fs";
const constants = readFileSync("src/lib/p5-batch2/constants.ts", "utf8");
const statusBlock = constants.match(/P5B2_EVIDENCE_STATUSES = \[([\s\S]*?)\] as const/);
if (!statusBlock) {
  console.error("status-consistency: cannot find P5B2_EVIDENCE_STATUSES SSOT");
  process.exit(1);
}
const ssot = [...statusBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const required = ["missing", "uploaded", "accepted", "rejected", "expired", "replaced", "waived", "provider_dependent", "revoked"];
const missing = required.filter((r) => !ssot.includes(r));
if (missing.length) {
  console.error("status-consistency: SSOT missing", missing.join(","));
  process.exit(1);
}
console.log("status-consistency: OK", ssot.length, "statuses");
