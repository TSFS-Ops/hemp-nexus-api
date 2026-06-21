#!/usr/bin/env node
/**
 * Batch 11 — Forbidden wording on claim review/status surfaces.
 *
 *  - Claim approval must NEVER imply company verification, bank verification,
 *    authority grant or production/institutional usability.
 *  - Admin approval acknowledgement copy must appear verbatim in the
 *    admin claims-review surface.
 *  - Public wording must appear verbatim where claim approvals/rejections
 *    are shown.
 */
import { readFileSync } from "node:fs";

const FORBIDDEN_NEAR_APPROVAL = [
  "claim verified", "company verified by claim", "authority granted",
  "bank details verified by claim", "production-ready", "institutional reliance",
];
const surfaces = [
  "src/pages/admin/registry/ClaimsReview.tsx",
  "src/pages/registry/ClaimStatus.tsx",
  "src/pages/registry/ClaimsList.tsx",
  "supabase/functions/registry-claim-review/index.ts",
];
let failed = false;
for (const f of surfaces) {
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const w of FORBIDDEN_NEAR_APPROVAL) {
    if (src.includes(w.toLowerCase())) {
      console.error(`✗ forbidden wording "${w}" found in ${f}`);
      failed = true;
    }
  }
}

const ADMIN_ACK = "I understand that approving this claim does not verify authority-to-act, company profile accuracy or bank details.";
if (!readFileSync("src/pages/admin/registry/ClaimsReview.tsx", "utf8").includes(ADMIN_ACK) &&
    !readFileSync("src/pages/admin/registry/ClaimsReview.tsx", "utf8").includes("REGISTRY_CLAIM_ADMIN_APPROVAL_ACK")) {
  console.error("✗ admin claims-review page missing approval acknowledgement");
  failed = true;
}

const PUBLIC_APPROVAL = "Claim approved. This confirms that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";
const status = readFileSync("src/pages/registry/ClaimStatus.tsx", "utf8");
if (!status.includes("REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING") && !status.includes(PUBLIC_APPROVAL)) {
  console.error("✗ ClaimStatus page missing approval public wording");
  failed = true;
}

if (failed) process.exit(1);
console.log("✓ batch-11 no-verified-claim wording OK");
