#!/usr/bin/env node
/**
 * Admin Export Controls Batch 10 — prebuild guard.
 *
 * Pins the manual QA pack to its read-only, no-generation contract:
 *
 *  1. The QA pack file exists at the canonical path.
 *  2. The QA pack still explicitly disclaims file generation /
 *     download / signed/temporary link / prepare / destroy surfaces
 *     (so it cannot silently mutate into permission to build them).
 *  3. The QA pack still requires platform_admin + AAL2 gating
 *     and the read-only / no-generation boundary language.
 *  4. The QA pack is NOT accompanied by any new runtime source
 *     introducing file generation, Blob, Content-Disposition,
 *     signed URLs, temporary links, downloads, prepare, or destroy
 *     surfaces in the export-controls UI or edge functions.
 *
 * Batch 10 is documentation-only. This guard fails the build if it
 * starts being something else.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];

const QA = "evidence/admin-export-controls-batch-10-manual-qa-pack.md";

if (!existsSync(QA)) {
  failures.push(`Batch 10 QA pack missing at ${QA}`);
} else {
  const src = readFileSync(QA, "utf8");
  const required = [
    [/platform_admin/, "must require platform_admin gating"],
    [/AAL2/, "must require AAL2 gating"],
    [/MFA_REQUIRED/, "must reference MFA_REQUIRED messaging"],
    [/NOT_PLATFORM_ADMIN/, "must reference NOT_PLATFORM_ADMIN messaging"],
    [/no-generation boundary/i, "must keep the no-generation boundary language"],
    [/no file/i, "must keep 'no file' wording"],
    [/no download link/i, "must keep 'no download link' wording"],
    [/no temporary link/i, "must keep 'no temporary link' wording"],
    [/Batch 7C/, "must reference the Batch 7C production-guard posture"],
    [/redacted_client_safe/, "must pin the default redaction mode"],
    [/legal-hold/i, "must include the safe-summary legal-hold indicator check"],
  ];
  for (const [re, label] of required) {
    if (!re.test(src)) failures.push(`QA pack: ${label}`);
  }

  // The QA pack must NOT instruct testers to perform or expect
  // file generation, downloads, prepare, destroy, signed/temporary
  // links — as actions, only as forbidden surfaces.
  const forbiddenInstruction = [
    [/\bclick\s+download\b/i, "must not instruct testers to click download"],
    [/\bdownload the (csv|pdf|json|file)\b/i, "must not instruct testers to download a file"],
    [/\bgenerate (the )?export\b/i, "must not instruct testers to generate an export"],
    [/\bprepare (the )?export\b/i, "must not instruct testers to prepare an export"],
    [/\bdestroy (the )?export\b/i, "must not instruct testers to destroy an export"],
  ];
  for (const [re, label] of forbiddenInstruction) {
    if (re.test(src)) failures.push(`QA pack: ${label}`);
  }
}

// 2. No new runtime generation surface introduced in the export-controls
//    UI or edge functions as part of Batch 10. We re-scan the canonical
//    panels and edge functions for forbidden tokens. Any drift here means
//    Batch 10 has stopped being documentation-only.
const RUNTIME_TARGETS = [
  "supabase/functions/admin-governance-export-list/index.ts",
  "supabase/functions/admin-governance-export-preview/index.ts",
  "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx",
  "src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx",
];

const FORBIDDEN_RUNTIME = [
  [/createSignedUrl\s*\(/, "createSignedUrl"],
  [/\bsigned_url\b/, "signed_url token"],
  [/storage\.from\([^)]*\)\.upload\s*\(/, "storage upload"],
  [/storage\.from\([^)]*\)\.download\s*\(/, "storage download"],
  [/new\s+Blob\s*\(/, "new Blob("],
  [/URL\.createObjectURL\s*\(/, "URL.createObjectURL("],
  [/Content-Disposition/i, "Content-Disposition"],
  [/text\/csv/i, "text/csv"],
  [/application\/pdf/i, "application/pdf"],
  [/<a[^>]*\bdownload\b/i, "anchor download attribute"],
  [/["']export-prepare["']/, "export-prepare invocation"],
  [/["']export-download["']/, "export-download invocation"],
  [/["']export-destroy["']/, "export-destroy invocation"],
  [/["']admin-export-prepare["']/, "admin-export-prepare invocation"],
  [/["']admin-governance-export-prepare["']/, "admin-governance-export-prepare invocation"],
  [/["']admin-governance-export-download["']/, "admin-governance-export-download invocation"],
  [/["']admin-governance-export-destroy["']/, "admin-governance-export-destroy invocation"],
];

for (const path of RUNTIME_TARGETS) {
  if (!existsSync(path)) {
    failures.push(`Batch 10 sanity: expected runtime target missing: ${path}`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  for (const [re, label] of FORBIDDEN_RUNTIME) {
    if (re.test(src)) {
      failures.push(`Batch 10 sanity: ${path} introduced forbidden token "${label}"`);
    }
  }
}

// 3. Batch 7C production-guard files must still exist and still ship the
//    refusal — Batch 10 must not have weakened them.
const SMOKE = "supabase/functions/admin-export-batch-7c-smoke/index.ts";
if (!existsSync(SMOKE)) {
  failures.push(`Batch 7C smoke runner missing at ${SMOKE} — Batch 10 must not remove it`);
} else {
  const src = readFileSync(SMOKE, "utf8");
  if (!/is_production_environment|production/i.test(src)) {
    failures.push("Batch 7C smoke runner no longer references the production environment guard");
  }
}

// 4. The QA pack must not have spawned sibling .md generation/download
//    docs alongside it (defensive — keeps scope tight).
const EVIDENCE_DIR = "evidence";
if (existsSync(EVIDENCE_DIR)) {
  for (const entry of readdirSync(EVIDENCE_DIR)) {
    if (!/admin-export-controls-batch-10/.test(entry)) continue;
    if (entry === "admin-export-controls-batch-10-manual-qa-pack.md") continue;
    const full = join(EVIDENCE_DIR, entry);
    if (statSync(full).isFile()) {
      failures.push(`Batch 10 scope drift: unexpected sibling artifact ${full}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[check-admin-export-controls-batch-10] FAIL — manual QA pack contract drift:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nBatch 10 is documentation-only. It must not introduce file generation, " +
      "downloads, signed/temporary links, prepare, or destroy behaviour, and must " +
      "not weaken the Batch 7C production guard.",
  );
  process.exit(1);
}

console.log("[check-admin-export-controls-batch-10] OK — manual QA pack contract holds.");
