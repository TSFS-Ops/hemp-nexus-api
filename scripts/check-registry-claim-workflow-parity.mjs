#!/usr/bin/env node
/**
 * Batch 11 — Parity between src/lib/registry-claim-workflow.ts and
 * supabase/functions/_shared/registry-claim-workflow.ts for the SSOT arrays.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-claim-workflow.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-claim-workflow.ts", "utf8");

const arrays = [
  "REGISTRY_CLAIMANT_TYPES",
  "REGISTRY_EVIDENCE_CATEGORIES",
  "REGISTRY_EVIDENCE_STATES",
  "REGISTRY_CLAIM_WORKFLOW_STATUSES",
  "REGISTRY_CLAIM_REVIEW_ACTIONS",
  "REGISTRY_CLAIM_CONFLICT_OUTCOMES",
  "REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES",
];

let failed = false;
for (const name of arrays) {
  const re = new RegExp(`export const ${name} = \\[(.*?)\\] as const;`, "s");
  const a = ts.match(re);
  const b = deno.match(re);
  if (!a || !b) {
    console.error(`✗ missing ${name} in TS or Deno SSOT`);
    failed = true;
    continue;
  }
  const norm = (s) => s.replace(/\s+/g, "");
  if (norm(a[1]) !== norm(b[1])) {
    console.error(`✗ ${name} drift between TS and Deno SSOTs`);
    failed = true;
  }
}

// Mandatory wording must be present verbatim in both.
const WORDINGS = [
  "Claim approved. This confirms that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.",
  "Claim approval does not verify authority-to-act, company profile accuracy or bank details.",
  "Your claim was not approved. Please review the reason provided and submit a new claim only if you can provide the required evidence.",
  "I understand that approving this claim does not verify authority-to-act, company profile accuracy or bank details.",
];
for (const w of WORDINGS) {
  if (!ts.includes(w) || !deno.includes(w)) {
    console.error(`✗ wording drift: "${w.slice(0, 60)}…"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry claim-workflow SSOT parity OK");
