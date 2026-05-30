#!/usr/bin/env node
/**
 * Admin Export Controls Batch 5 — prebuild guard.
 *
 * Pins the Governance Record export request LIST VIEW to read-only:
 * platform_admin + AAL2, no prepare/generate/download/destroy/signed-URL
 * surfaces in either the edge function or the HQ panel, and no mutation
 * of export_requests rows from this batch's code paths.
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

// 1. Edge function — read-only, gated, no mutation/preparation/download.
const EDGE = "supabase/functions/admin-governance-export-list/index.ts";
check(EDGE, "edge:admin-governance-export-list", [
  ["calls assertAal2", /\bassertAal2\s*\(/, true],
  ["calls is_admin", /rpc\(\s*["']is_admin["']/, true],
  ["uses strict Zod schema", /\.strict\(\)/, true],
  ["scopes to kind=admin_export", /\.eq\(\s*["']kind["']\s*,\s*["']admin_export["']\s*\)/, true],
  [
    "requires non-null governance_record_id",
    /\.not\(\s*["']governance_record_id["']\s*,\s*["']is["']\s*,\s*null\s*\)/,
    true,
  ],
  ["uses .in for status filter", /\.in\(\s*["']status["']/, true],
  ["limits visible statuses to Batch 5 set", /BATCH_5_VISIBLE_STATUSES/, true],
  ["emits blocked_or_declined on denial", /DATA_010_AUDIT_ACTIONS\.blocked_or_declined/, true],
  ["returns NOT_PLATFORM_ADMIN code", /code:\s*["']NOT_PLATFORM_ADMIN["']/, true],
  ["returns MFA_REQUIRED code", /code:\s*["']MFA_REQUIRED["']/, true],
  ["NO signed URL minting", /createSignedUrl\s*\(|\bsigned_url\b/, false],
  ["NO storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["NO storage download", /storage\.from\([^)]*\)\.download\s*\(/, false],
  ["NO CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  ["NO export_requests mutation (.insert)", /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.insert\s*\(/, false],
  ["NO export_requests mutation (.update)", /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.update\s*\(/, false],
  ["NO export_requests mutation (.delete)", /from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.delete\s*\(/, false],
  ["NO prepare/download/destroy verbs", /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/, false],
  ["NO calls to export-prepare", /["']export-prepare["']/, false],
  ["NO calls to export-download", /["']export-download["']/, false],
  ["NO calls to export-destroy", /["']export-destroy["']/, false],
  ["NO calls to admin-export-prepare", /["']admin-export-prepare["']/, false],
  ["NO new status transition", /SET\s+status\s*=\s*/i, false],
  ["NO raw approve RPC call", /rpc\(\s*["']approve_admin_governance_export["']/, false],
]);

// 2. List panel — read-only, no destructive controls / wording.
const PANEL =
  "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx";
check(PANEL, "panel:AdminGovernanceExportRequestsListPanel", [
  ["guards on isPlatformAdmin", /isPlatformAdmin/, true],
  [
    "invokes only admin-governance-export-list",
    /supabase\.functions\.invoke\(\s*\n?\s*["']admin-governance-export-list["']/,
    true,
  ],
  ["renders AAL2 banner", /AAL2 required/, true],
  ["renders empty state", /No Governance Record export requests/, true],
  ["renders contract reassurance badge", /No file generated · No download link/, true],
  ["legal-hold indicator present", /legal-hold context/, true],
  // Negative surface set.
  [
    "no other edge invokes",
    /supabase\.functions\.invoke\(\s*\n?\s*["'](?!admin-governance-export-list["'])/,
    false,
  ],
  ["no signed URL", /signedUrl|createSignedUrl|signed_url/, false],
  ["no downloadCSV", /\bdownloadCSV(?:Raw)?\s*\(/, false],
  ["no CSV/Blob output", /new\s+Blob\s*\(|text\/(csv|plain|json|pdf)/i, false],
  ["no anchor download attribute", /<a[^>]*\bdownload\b/i, false],
  [
    "no prepare/destroy/generate/download buttons",
    /Prepare export|Destroy export|Generate export|Download export|Download CSV|Download JSON|Download PDF/i,
    false,
  ],
  [
    "no 'ready to download' wording",
    /ready to download|export ready|ready_for_download/i,
    false,
  ],
  ["no export-prepare invocation", /["']export-prepare["']/, false],
  ["no export-download invocation", /["']export-download["']/, false],
  ["no export-destroy invocation", /["']export-destroy["']/, false],
  ["no admin-governance-export-approve invocation",
    /["']admin-governance-export-approve["']/, false],
  ["no approve_admin_governance_export RPC", /approve_admin_governance_export/, false],
  ["no direct export_requests update", /\.from\(\s*["']export_requests["']\s*\)[\s\S]{0,80}\.(update|insert|delete)\s*\(/, false],
]);

// 3. Mount: list panel is wired into HQ Governance Records tab.
check("src/pages/HQ.tsx", "mount:HQ", [
  [
    "imports AdminGovernanceExportRequestsListPanel",
    /from\s+["']@\/components\/admin\/governance\/AdminGovernanceExportRequestsListPanel["']/,
    true,
  ],
  [
    "mounts AdminGovernanceExportRequestsListPanel",
    /<AdminGovernanceExportRequestsListPanel\s*\/>/,
    true,
  ],
  [
    "adds 'export-requests' sub-tab id",
    /\["records",\s*"memory",\s*"export-requests"\]/,
    true,
  ],
]);

// 4. Test file presence + headline contract pins.
check(
  "src/tests/admin-export-controls-batch-5.test.ts",
  "test:admin-export-controls-batch-5",
  [
    ["pins MFA_REQUIRED", /MFA_REQUIRED/, true],
    ["pins NOT_PLATFORM_ADMIN", /NOT_PLATFORM_ADMIN/, true],
    [
      "pins read-only contract",
      /read[- ]only/i,
      true,
    ],
    ["pins no-file-generation", /No file generated/i, true],
  ],
);

if (failures.length > 0) {
  console.error(
    "[check-admin-export-controls-batch-5] FAIL — list-view contract drift:",
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nList view is READ-ONLY. No prepare, no generate, no download, no destroy, no signed URL. Approval semantics (Batch 4) and request semantics (Batch 2) are unchanged.",
  );
  process.exit(1);
}

console.log(
  "[check-admin-export-controls-batch-5] OK — list-view read-only contract holds.",
);
