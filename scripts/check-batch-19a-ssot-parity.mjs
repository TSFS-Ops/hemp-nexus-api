#!/usr/bin/env node
/** Batch 19A — SSOT parity guard. Ensures the client-decision SSOT file exists
 *  and exports the canonical symbols other code must import from. */
import fs from "node:fs";

const SSOT = "src/lib/registry-client-decisions-19a.ts";
if (!fs.existsSync(SSOT)) {
  console.error(`[batch-19a] missing SSOT file: ${SSOT}`);
  process.exit(1);
}
const src = fs.readFileSync(SSOT, "utf8");
const required = [
  "BATCH_19A_CLAIM_STARTER_CATEGORIES",
  "BATCH_19A_IMMEDIATE_CLAIM_CATEGORIES",
  "BATCH_19A_UNREGISTERED_USER_FLOW",
  "BATCH_19A_CLAIM_APPROVED_LIMITED_STATE",
  "BATCH_19A_CLAIM_APPROVED_LIMITED_COPY",
  "BATCH_19A_EVIDENCE_MATRIX",
  "BATCH_19A_EVIDENCE_MAX_AGE_MONTHS",
  "BATCH_19A_REPRESENTATIVE_PRE_AUTHORITY_FORBIDDEN",
  "BATCH_19A_CLAIM_CONFLICT_STATE",
  "BATCH_19A_PUBLIC_SEARCHABLE_FIELDS",
  "BATCH_19A_NEVER_PUBLICLY_SEARCHABLE_FIELDS",
  "BATCH_19A_PROFILE_HIDDEN_FROM_PUBLIC_AND_API",
  "BATCH_19A_REQUIRED_PUBLIC_PROFILE_LABEL",
  "BATCH_19A_REQUIRED_SAMPLE_RECORD_LABEL",
  "BATCH_19A_SAMPLE_ONLY_RECORDS",
  "BATCH_19A_SAMPLE_ONLY_API_RULES",
  "BATCH_19A_NEW_COMPANY_FLOW",
  "BATCH_19A_CLAIMANT_NEVER_DIRECT_EDIT",
  "BATCH_19A_OUTREACH_RULES",
  "BATCH_19A_AUDIT_EVENT_NAMES",
];
const missing = required.filter((s) => !src.includes(`export const ${s}`));
if (missing.length) {
  console.error(`[batch-19a] SSOT missing exports: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`[batch-19a] SSOT parity ok (${required.length} symbols)`);
