#!/usr/bin/env node
// Batch 7 — Parity guard: TS ↔ Deno SSOT for registry claim rules.
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-claim-rules.ts", "utf8");
const dn = readFileSync("supabase/functions/_shared/registry-claim-rules.ts", "utf8");

const arrays = [
  "REGISTRY_CLAIMANT_ROLE_TYPES",
  "REGISTRY_CLAIM_INTEREST_STATES",
  "REGISTRY_CLAIM_CONFLICT_STATES",
  "REGISTRY_EVIDENCE_CATEGORIES",
  "REGISTRY_SEARCHABILITY_TIERS",
  "REGISTRY_VISIBILITY_TIERS",
  "REGISTRY_IMPORTED_RECORD_READINESS_STATES",
  "REGISTRY_NEW_COMPANY_REQUEST_STATES",
  "REGISTRY_CORRECTION_REQUEST_STATES",
  "REGISTRY_OUTREACH_CHANNEL_PERMISSIONS",
  "REGISTRY_BATCH7_AUDIT_EVENT_NAMES",
  "REGISTRY_IMPORTED_UNVERIFIED_API_STATUS_RESPONSES",
  "REGISTRY_SEARCH_REQUIRED_FEATURES",
  "REGISTRY_NEW_COMPANY_REQUEST_REQUIRED_FIELDS",
  "REGISTRY_CLAIM_APPROVAL_ROLES",
];

let failed = false;
for (const name of arrays) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const tsV = (ts.match(re)?.[1] ?? "").replace(/\s+/g, "");
  const dnV = (dn.match(re)?.[1] ?? "").replace(/\s+/g, "");
  if (!tsV || !dnV || tsV !== dnV) {
    console.error(`[batch7-parity] drift in ${name}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("[batch7-parity] OK");
