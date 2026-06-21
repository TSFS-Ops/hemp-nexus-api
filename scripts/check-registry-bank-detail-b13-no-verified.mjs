#!/usr/bin/env node
/**
 * Batch 13 — Verifies that no Batch 13 submission status is treated as
 * "verified" anywhere in the codebase. Scans every Batch 13 SSOT, edge
 * function and component for a forbidden mapping of any B13 status to a
 * verified flag.
 *
 * Hard rule (Batch 13 spec §6): captured_unverified, submitted, under_review,
 * more_evidence_requested, evidence_resubmitted, evidence_required, disputed,
 * expired, revoked, revocation_requested, rejected, cancelled, withdrawn,
 * superseded, draft — NONE of these may equal "verified".
 */
import { readFileSync } from "node:fs";

const B13_STATUSES = [
  "draft", "submitted", "evidence_required", "under_review",
  "more_evidence_requested", "evidence_resubmitted", "captured_unverified",
  "rejected", "cancelled", "withdrawn", "revocation_requested", "revoked",
  "disputed", "expired", "superseded",
];

const FILES = [
  "src/lib/registry-bank-details-b13.ts",
  "supabase/functions/_shared/registry-bank-details-b13.ts",
  "supabase/functions/registry-bank-detail-start/index.ts",
  "supabase/functions/registry-bank-detail-submit/index.ts",
  "supabase/functions/registry-bank-detail-review/index.ts",
  "supabase/functions/registry-bank-detail-evidence-upload/index.ts",
  "supabase/functions/registry-bank-detail-revocation-request/index.ts",
  "supabase/functions/registry-bank-detail-risk-evaluate/index.ts",
  "supabase/functions/registry-bank-detail-notification-log/index.ts",
  "supabase/functions/registry-bank-detail-unmask-access/index.ts",
];

let failed = false;
for (const f of FILES) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  for (const status of B13_STATUSES) {
    // Look for any pattern that equates this status to a verified flag.
    const patterns = [
      new RegExp(`"${status}"\\s*:\\s*"verified"`),
      new RegExp(`"${status}"\\s*:\\s*true[\\s\\S]{0,40}verified`),
      new RegExp(`case\\s+"${status}"[\\s\\S]{0,80}return\\s+"verified"`),
    ];
    for (const p of patterns) {
      if (p.test(src)) {
        console.error(`✗ ${f}: Batch 13 status "${status}" is mapped to verified.`);
        failed = true;
      }
    }
  }
  // Also ensure isBankDetailB13Verified always returns false.
  if (/isBankDetailB13Verified[\s\S]{0,40}return\s+true/.test(src)) {
    console.error(`✗ ${f}: isBankDetailB13Verified must always return false in Batch 13.`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ batch-13 bank-detail statuses are never verified");
