#!/usr/bin/env node
/**
 * Batch 4 — pins mandatory non-verification copy across SSOT + Deno mirror +
 * admin review surfaces. Also pins captured-not-verified copy across both
 * user-facing and admin bank-detail surfaces.
 */
import { readFileSync } from "node:fs";

const AUTHORITY_COPY = "Approving authority confirms only that this person may act for the company within the recorded scope. It does not verify the company profile or any bank details.";
const BANK_COPY = "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry.";

const REQUIRED = {
  "src/lib/registry-authority.ts": [AUTHORITY_COPY],
  "supabase/functions/_shared/registry-authority.ts": [AUTHORITY_COPY],
  "supabase/functions/registry-authority-review/index.ts": [AUTHORITY_COPY],
  "src/pages/admin/registry/Authority.tsx": [AUTHORITY_COPY],
  "src/lib/registry-bank-details.ts": [BANK_COPY],
  "supabase/functions/_shared/registry-bank-details.ts": [BANK_COPY],
  "supabase/functions/registry-bank-detail-submit/index.ts": [BANK_COPY],
  "src/pages/registry/BankDetails.tsx": [BANK_COPY],
  "src/pages/admin/registry/BankDetails.tsx": [BANK_COPY],
};

let failed = false;
for (const [file, phrases] of Object.entries(REQUIRED)) {
  const src = readFileSync(file, "utf8");
  for (const p of phrases) {
    if (!src.includes(p)) { console.error(`✗ ${file} missing required Batch 4 wording`); failed = true; }
  }
}

// Forbid "verified" claim on Batch 4 user-facing capture page outside the
// allow-listed phrases.
const userCapture = readFileSync("src/pages/registry/BankDetails.tsx", "utf8");
const forbiddenWordsContext = userCapture.match(/are verified bank details/i);
if (forbiddenWordsContext) { console.error("✗ user-facing bank capture page claims captured details are verified"); failed = true; }

if (failed) process.exit(1);
console.log("✓ Batch 4 mandatory wording present");
