#!/usr/bin/env node
/**
 * P011 — Counterparty Rating SSOT parity guard.
 * Asserts that `src/lib/evidence-rating.ts` and
 * `supabase/functions/_shared/evidence-rating.ts` declare the same bands,
 * forbidden words, override reasons, freshness windows, audit names, and
 * methodology version constant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  resolve("src/lib/evidence-rating.ts"),
  resolve("supabase/functions/_shared/evidence-rating.ts"),
];

const PINS = [
  /COUNTERPARTY_RATING_METHODOLOGY_VERSION\s*=\s*"1\.0"/,
  /"limited_information"/,
  /"public_source_supported"/,
  /"admin_reviewed"/,
  /"verification_complete"/,
  /"flagged"/,
  /"safe"/, /"trusted"/, /"approved"/, /"compliant"/,
  /"low risk"/, /"high risk"/, /"guaranteed"/, /"cleared"/, /"bank verified"/,
  /"evidence_corrected"/, /"false_positive"/, /"new_document_reviewed"/,
  /"expired_check_reviewed"/, /"dispute_resolved"/, /"admin_block"/,
  /"methodology_exception"/, /"data_error"/,
  /EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH\s*=\s*30/,
  /EVIDENCE_RATING_OVERRIDE_MAX_DAYS_DEFAULT\s*=\s*90/,
  /public_source:\s*30/,
  /sanctions_pep:\s*7/,
  /kyb_registry:\s*365/,
  /ubo_authority:\s*365/,
  /uploaded_evidence:\s*365/,
  /admin_review:\s*90/,
  /"counterparty_rating\.rating_calculated"/,
  /"counterparty_rating\.rating_refreshed"/,
  /"counterparty_rating\.rating_changed"/,
  /"counterparty_rating\.rating_marked_stale"/,
  /"counterparty_rating\.rating_flag_added"/,
  /"counterparty_rating\.rating_flag_removed"/,
  /"counterparty_rating\.rating_viewed_by_admin"/,
  /"counterparty_rating\.rating_override_applied"/,
  /"counterparty_rating\.rating_override_changed"/,
  /"counterparty_rating\.rating_override_removed"/,
  /"counterparty_rating\.rating_recalculation_failed"/,
  /"counterparty_rating\.methodology_version_changed"/,
  /"cipc"/, /"onfido"/, /"dow_jones"/, /"refinitiv"/,
  /computeEvidenceRating/,
];

const errors = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const re of PINS) {
    if (!re.test(src)) errors.push(`${f}: missing pin ${re}`);
  }
}

if (errors.length) {
  console.error("[check-evidence-rating-parity] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`[check-evidence-rating-parity] OK (${PINS.length} pins across 2 files)`);
