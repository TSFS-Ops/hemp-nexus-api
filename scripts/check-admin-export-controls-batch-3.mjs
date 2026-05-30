#!/usr/bin/env node
/**
 * Admin Export Controls Batch 3 — prebuild guard.
 *
 * Extends the Batch 2 guard with stricter Batch 3 invariants:
 *
 *  - The Batch-3 contract test file exists and pins the redaction allow-list,
 *    the platform_admin + AAL2 gates, and the request-only (no approve /
 *    prepare / download / destroy) boundary.
 *  - The Batch-2 edge function and panel still do not contain any
 *    approve / prepare / download / destroy / signed-URL / Blob-CSV /
 *    "export all" surfaces.
 *  - The Governance Record export migration retains the redaction CHECK
 *    constraint and the SECURITY DEFINER / service-role-only RPC contract.
 *
 * This guard is intentionally narrow: it does not approve future batches,
 * it only stops Batch 3 from silently crossing into Batch 4 scope.
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];

function check(path, label, predicates) {
  if (!existsSync(path)) {
    failures.push(`${label}: missing file ${path}`);
    return;
  }
  const src = readFileSync(path, "utf8");
  for (const [name, re, expect] of predicates) {
    const found = re.test(src);
    if (found !== expect) {
      failures.push(
        `${label}: predicate "${name}" expected ${expect ? "PRESENT" : "ABSENT"} but was ${found ? "PRESENT" : "ABSENT"} in ${path}`,
      );
    }
  }
}

// 1. Batch 3 contract test file must exist and cover the headline pins.
check(
  "src/tests/admin-export-controls-batch-3.test.ts",
  "test:admin-export-controls-batch-3",
  [
    ["pins MFA_REQUIRED contract", /MFA_REQUIRED/, true],
    ["pins NOT_PLATFORM_ADMIN contract", /NOT_PLATFORM_ADMIN/, true],
    ["pins redacted_client_safe default", /redacted_client_safe/, true],
    ["pins awaiting_approval status", /awaiting_approval/, true],
    [
      "asserts no approve/prepare/download surface in edge",
      /admin_export_approved|admin_export_prepared|admin_export_downloaded/,
      true,
    ],
  ],
);

// 2. Batch 2 edge function must remain request-only.
const EDGE = "supabase/functions/admin-governance-export-request/index.ts";
check(EDGE, "edge:admin-governance-export-request", [
  ["no signed URL minting", /createSignedUrl\s*\(|\bsigned_url\b/, false],
  ["no storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["no CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  [
    "no approve/prepare/download/destroy verbs",
    /admin_export_approved|admin_export_prepared|admin_export_downloaded|admin_export_destroyed/,
    false,
  ],
  ["still calls assertAal2", /\bassertAal2\s*\(/, true],
  ["still calls is_admin RPC", /rpc\(\s*["']is_admin["']/, true],
  ["uses strict Zod schema", /\.strict\(\)/, true],
]);

// 3. Batch 2 panel must remain request-only.
const PANEL =
  "src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx";
check(PANEL, "panel:AdminGovernanceExportRequestPanel", [
  ["no signed URL handling", /signedUrl|createSignedUrl|signed_url/, false],
  ["no downloadCSV", /\bdownloadCSV(?:Raw)?\s*\(/, false],
  ["no CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  ["no anchor download attribute", /<a[^>]*\bdownload\b/i, false],
  [
    "no approve/prepare/download/destroy verbs",
    /Approve export|Prepare export|Download export|Destroy export/i,
    false,
  ],
  [
    "no 'export all' / 'dump all' wording",
    /\bexport[_\s-]?all\b|\bdump[_\s-]?all\b/i,
    false,
  ],
  ["guards visibility on isPlatformAdmin", /isPlatformAdmin/, true],
  ["shows 'No file generated'", /No file generated/, true],
  ["shows 'No download link'", /No download link/, true],
]);

// 4. Migration contract pins.
const MIGRATION =
  "supabase/migrations/20260530063841_55c7e98e-fee7-4816-861b-6cc3f691c4e3.sql";
check(MIGRATION, "migration:batch-2-export-request", [
  [
    "redaction CHECK constraint defined",
    /export_requests_redaction_mode_domain/,
    true,
  ],
  ["SECURITY DEFINER RPC", /SECURITY DEFINER/, true],
  [
    "REVOKE from PUBLIC, anon, authenticated",
    /REVOKE EXECUTE ON FUNCTION public\.request_admin_governance_export[\s\S]*FROM PUBLIC,\s*anon,\s*authenticated/,
    true,
  ],
  [
    "GRANT only to service_role",
    /GRANT EXECUTE ON FUNCTION public\.request_admin_governance_export[\s\S]*TO service_role/,
    true,
  ],
  ["writes awaiting_approval status", /'awaiting_approval'/, true],
]);

if (failures.length > 0) {
  console.error(
    "[check-admin-export-controls-batch-3] FAIL — Batch 3 contract drift:",
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nBatch 3 is test/proof-only. Approve / prepare / download / destroy / file generation belong to a future, separately-approved batch.",
  );
  process.exit(1);
}

console.log(
  "[check-admin-export-controls-batch-3] OK — request-only contract holds.",
);
