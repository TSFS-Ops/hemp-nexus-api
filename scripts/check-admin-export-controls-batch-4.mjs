#!/usr/bin/env node
/**
 * Admin Export Controls Batch 4 — prebuild guard.
 *
 * Pins the approval shell to "approved means approved only — not prepared,
 * not generated, not downloadable" by failing the build if the new edge
 * function or panel grows any prepare/download/destroy/signed-URL surface
 * or if the Batch 4 migration is removed.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

// 1. Batch 4 test file present and pins headline contract.
check(
  "src/tests/admin-export-controls-batch-4.test.ts",
  "test:admin-export-controls-batch-4",
  [
    ["pins MFA_REQUIRED", /MFA_REQUIRED/, true],
    ["pins NOT_PLATFORM_ADMIN", /NOT_PLATFORM_ADMIN/, true],
    ["pins SELF_APPROVAL_BLOCKED", /SELF_APPROVAL_BLOCKED/, true],
    ["pins approved-only forward transition", /Approved means approved only/i, true],
  ],
);

// 2. Approve edge function stays request/decision-only.
const EDGE = "supabase/functions/admin-governance-export-approve/index.ts";
check(EDGE, "edge:admin-governance-export-approve", [
  ["calls assertAal2", /\bassertAal2\s*\(/, true],
  ["calls is_admin", /rpc\(\s*["']is_admin["']/, true],
  ["uses strict Zod schema", /\.strict\(\)/, true],
  ["calls approve_admin_governance_export RPC",
    /rpc\(\s*["']approve_admin_governance_export["']/, true],
  ["emits DATA_010_AUDIT_ACTIONS.approved", /DATA_010_AUDIT_ACTIONS\.approved/, true],
  ["emits DATA_010_AUDIT_ACTIONS.blocked_or_declined",
    /DATA_010_AUDIT_ACTIONS\.blocked_or_declined/, true],
  ["no signed URL minting", /createSignedUrl\s*\(|\bsigned_url\b/, false],
  ["no storage upload", /storage\.from\([^)]*\)\.upload\s*\(/, false],
  ["no CSV/Blob output", /new\s+Blob\s*\(|text\/csv/i, false],
  [
    "no prepare/download/destroy/generated verbs",
    /admin_export_prepared|admin_export_downloaded|admin_export_destroyed|admin_export_generated/,
    false,
  ],
]);

// 3. Approval panel renders no download / signed URL / prepare / destroy.
const PANEL =
  "src/components/admin/governance/AdminGovernanceExportApprovalPanel.tsx";
check(PANEL, "panel:AdminGovernanceExportApprovalPanel", [
  ["guards on isPlatformAdmin", /isPlatformAdmin/, true],
  ["invokes only approve edge function",
    /"admin-governance-export-approve"/, true],
  ["does NOT invoke prepare/download/destroy",
    /"export-prepare"|"export-download"|"admin-export-destroy"|"admin-export-prepare"/, false],
  ["no signed URL", /signedUrl|createSignedUrl|signed_url/, false],
  ["no downloadCSV", /\bdownloadCSV(?:Raw)?\s*\(/, false],
  ["no CSV/Blob output", /new\s+Blob\s*\(|text\/(csv|plain|json|pdf)/i, false],
  ["no anchor download attribute", /<a[^>]*\bdownload\b/i, false],
  ["no 'export all' / 'dump all' wording",
    /\bexport[_\s-]?all\b|\bdump[_\s-]?all\b/i, false],
  ["no 'ready to download' wording", /ready to download|export ready/i, false],
  ["no Prepare/Destroy buttons",
    /Prepare export|Destroy export|Generate export|Download export/i, false],
  ["shows No file generated", /No file generated/, true],
  ["shows No download link", /No download link/, true],
  ["blocks self-approval visibly", /Self-approval blocked/, true],
]);

// 4. Batch 4 migration must exist and pin approval-only transition.
const MIGRATIONS_DIR = "supabase/migrations";
let migrationPath = null;
try {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files.sort().reverse()) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (body.includes("approve_admin_governance_export")) {
      migrationPath = join(MIGRATIONS_DIR, f);
      break;
    }
  }
} catch (e) {
  failures.push(`migration scan failed: ${String(e)}`);
}
if (!migrationPath) {
  failures.push("Batch 4 migration (approve_admin_governance_export) not found");
} else {
  check(migrationPath, "migration:batch-4-approval", [
    ["adds 'approved' status", /'approved'/, true],
    ["SECURITY DEFINER", /SECURITY DEFINER/, true],
    ["locks search_path", /SET search_path\s*=\s*public/, true],
    ["REVOKE from PUBLIC/anon/authenticated",
      /REVOKE EXECUTE ON FUNCTION public\.approve_admin_governance_export[\s\S]*FROM PUBLIC,\s*anon,\s*authenticated/, true],
    ["GRANT only to service_role",
      /GRANT EXECUTE ON FUNCTION public\.approve_admin_governance_export[\s\S]*TO service_role/, true],
    ["SELF_APPROVAL_BLOCKED inside RPC", /SELF_APPROVAL_BLOCKED/, true],
    ["transitions only to 'approved'", /SET\s+status\s*=\s*'approved'/, true],
    ["never writes 'ready_for_download'", /SET\s+status\s*=\s*'ready_for_download'/, false],
    ["never writes 'downloaded'", /SET\s+status\s*=\s*'downloaded'/, false],
    ["never writes 'destroyed'", /SET\s+status\s*=\s*'destroyed'/, false],
    ["never writes 'export_preparation_required'",
      /SET\s+status\s*=\s*'export_preparation_required'/, false],
  ]);
}

if (failures.length > 0) {
  console.error(
    "[check-admin-export-controls-batch-4] FAIL — approval shell drift:",
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nApproved means approved only — not prepared, not generated, not downloadable. Approve / prepare / download / destroy are separately-approved future batches.",
  );
  process.exit(1);
}

console.log(
  "[check-admin-export-controls-batch-4] OK — approval-only contract holds.",
);
