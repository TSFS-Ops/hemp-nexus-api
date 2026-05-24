#!/usr/bin/env node
// DEC-007 / PAY-009 — pin canonical audit names across TS + Deno mirrors.
import fs from "node:fs";
const REQUIRED = [
  "billing.refund_requested",
  "billing.refund_approved",
  "billing.refund_declined",
  "billing.refund_blocked_credits_used",
  "billing.refund_blocked_credits_expired",
  "billing.credit_adjustment_recorded",
  "billing.payment_dispute_detected",
  "billing.credits_frozen_due_to_dispute",
  "billing.used_credits_marked_billing_review",
  "billing.payment_dispute_resolved_won",
  "billing.payment_dispute_resolved_lost",
  "billing.org_billing_hold_applied",
  "billing.org_billing_hold_released",
];
const FILES = [
  "src/lib/policy/dec-007-pay-009-audit.ts",
  "supabase/functions/_shared/dec-007-pay-009-audit.ts",
];
let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) { console.error(`[check-dec-007-pay-009-audit-names] missing file: ${f}`); failed = true; continue; }
  const src = fs.readFileSync(f, "utf8");
  for (const n of REQUIRED) {
    if (!src.includes(`"${n}"`)) {
      console.error(`[check-dec-007-pay-009-audit-names] ${f} missing canonical "${n}"`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`[check-dec-007-pay-009-audit-names] ok — ${REQUIRED.length} canonical names pinned in both mirrors.`);
