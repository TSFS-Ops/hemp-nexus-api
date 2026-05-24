#!/usr/bin/env node
/**
 * DATA-009 Phase 1 prebuild guard — data-residency claim scanner.
 *
 * Source of truth: signed Client-Only Decision Form, DATA-009.
 *
 * Phase 1 objective is truthfulness: stop the platform, admin surfaces,
 * and documentation from making unapproved data-residency claims while
 * the actual exception workflow (residency_review_required state,
 * onboarding_hold_residency_review stage, approval/decline emissions) is
 * still Phase 2 and not implemented.
 *
 * The guard:
 *   1. Scans the listed public / admin / docs files.
 *   2. Fails the build if any forbidden unapproved-residency phrase
 *      appears on a line that does NOT also carry the `DATA_009_ALLOW`
 *      marker or cautious-approval qualifiers (both "separate" and
 *      "approval" present on the same line).
 *   3. Asserts the DATA-009 policy SSOT exists at
 *      `src/lib/policy/data-residency-policy.ts` and declares the four
 *      canonical audit action names exactly once each.
 *
 * The policy SSOT, the DATA-009 test file, and `scripts/check-data-009-
 * residency-claims.mjs` itself are intentionally excluded from the
 * file-list scan: they are the sanctioned home for the forbidden
 * strings.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const SCAN_FILES = [
  "src/components/landing/HeroStripeGlow.tsx",
  "src/pages/solutions/Sovereigns.tsx",
  "src/pages/products/TradeDesk.tsx",
  "src/components/admin/BrdConstraintsPanel.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/Developers.tsx",
  "src/pages/Welcome.tsx",
  "src/pages/Docs.tsx",
  "src/pages/Status.tsx",
  "src/pages/solutions/Traders.tsx",
  "src/pages/solutions/Finance.tsx",
  "src/components/PublicHeader.tsx",
  "docs/getting-started.md",
  "docs/infrastructure-requirements.md",
];

// Forbidden unapproved-residency phrases (case-insensitive substring).
// Mirrors the list specified by DATA-009 Phase 1.
const FORBIDDEN_PHRASES = [
  "EU-only",
  "SA-only",
  "South Africa-only",
  "local-only",
  "sovereign data",
  "sovereign residency",
  "per-organisation residency",
  "per-organization residency",
  "jurisdiction-locked data residency",
  "jurisdiction residency lock",
  "region selectable at onboarding",
  "residency is enforced",
  "no cross-border movement",
  "permanent regional data-residency lock",
  "regional data-residency lock",
];

const POLICY_FILE = "src/lib/policy/data-residency-policy.ts";
const REQUIRED_AUDIT_NAMES = [
  "data.residency_requirement_detected",
  "data.unapproved_residency_claim_blocked",
  "data.residency_exception_approved",
  "data.residency_exception_declined",
];

const errors = [];

// 1. Policy SSOT must exist and declare all four audit action names.
try {
  const policySrc = readFileSync(resolve(ROOT, POLICY_FILE), "utf8");
  for (const name of REQUIRED_AUDIT_NAMES) {
    if (!policySrc.includes(`"${name}"`)) {
      errors.push(
        `${POLICY_FILE} is missing canonical DATA-009 audit action name "${name}".`,
      );
    }
  }
} catch (err) {
  errors.push(`Could not read ${POLICY_FILE}: ${err.message}`);
}

// 2. Forbidden-phrase scan on listed surfaces.
const ALLOW_MARKER = "DATA_009_ALLOW";
function lineIsApprovedQualified(line) {
  const lower = line.toLowerCase();
  // Cautious approved wording requires BOTH "separate" and "approval"
  // on the same line, e.g. "...require separate Izenzo approval".
  return lower.includes("separate") && lower.includes("approval");
}

for (const rel of SCAN_FILES) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes(ALLOW_MARKER)) return;
    const lower = line.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase.toLowerCase())) {
        if (lineIsApprovedQualified(line)) continue;
        errors.push(
          `${rel}:${idx + 1}  forbidden DATA-009 phrase  "${phrase}"  →  ${line
            .trim()
            .slice(0, 140)}`,
        );
      }
    }
  });
}

if (errors.length > 0) {
  console.error("\n❌ DATA-009 Phase 1 residency-claim guard FAILED:\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nReplace with cautious approved wording (see " +
      "src/lib/policy/data-residency-policy.ts → " +
      "DATA_RESIDENCY_APPROVED_WORDING) or qualify the line with both " +
      "'separate' and 'approval'. The DATA_009_ALLOW marker is reserved " +
      "for the policy SSOT and test files only.\n",
  );
  process.exit(1);
}

console.log(
  "✅ DATA-009 Phase 1 residency-claim guard passed (policy SSOT present, no forbidden public/admin/docs claims).",
);
