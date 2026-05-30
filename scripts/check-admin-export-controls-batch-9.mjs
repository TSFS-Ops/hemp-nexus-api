#!/usr/bin/env node
/**
 * Admin Export Controls Batch 9 — prebuild guard.
 *
 * Pins the Redaction UI Preview Shell contract:
 *   - edge function `supabase/functions/admin-governance-export-preview/index.ts`
 *     enforces platform_admin (is_admin) + AAL2 (assertAal2)
 *   - consumes the Batch 8 redaction helper (`_shared/admin-export-redaction`)
 *   - defaults redaction_mode safely and accepts only the four canonical modes
 *   - emits only the canonical denial audit on refusal
 *   - performs NO mutations (.insert/.update/.delete/.upsert)
 *   - performs NO file generation (Blob, csv/pdf MIME, Content-Disposition,
 *     Deno.writeFile/writeTextFile)
 *   - performs NO signed-URL / storage / download surface
 *   - does NOT invoke other edge functions
 *   - does NOT touch the Batch 7C production guard or DATA-004 surface
 *   - HQ panel `AdminGovernanceExportPreviewPanel.tsx` renders the
 *     preview-only / no-download / no-signed-URL / AAL2 badges and renders
 *     no download / prepare / destroy / signed-URL / Blob / file anchor
 *     surface, and invokes only `admin-governance-export-preview`
 *   - prebuild wires this guard
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<![:"'`\\])\/\/[^\n]*/g, "");
}

const FN = "supabase/functions/admin-governance-export-preview/index.ts";
const PANEL =
  "src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx";
const EVIDENCE =
  "evidence/admin-export-controls-batch-9-redaction-preview-shell.md";
const PKG = "package.json";

for (const p of [FN, PANEL, EVIDENCE, PKG]) {
  if (!existsSync(p)) {
    console.error(`❌ Batch 9 required file missing: ${p}`);
    process.exit(1);
  }
}

const fnSrc = stripComments(readFileSync(FN, "utf8"));
const panelSrc = stripComments(readFileSync(PANEL, "utf8"));
const pkg = readFileSync(PKG, "utf8");

// --- Edge function: PRESENT requirements ---------------------------------
check(/admin\.rpc\(\s*["']is_admin["']/.test(fnSrc),
  "edge fn must call is_admin");
check(/NOT_PLATFORM_ADMIN/.test(fnSrc),
  "edge fn must surface NOT_PLATFORM_ADMIN");
check(/assertAal2\s*\(/.test(fnSrc),
  "edge fn must enforce assertAal2");
check(/MFA_REQUIRED/.test(fnSrc),
  "edge fn must surface MFA_REQUIRED");
check(/redactGovernanceRecord\s*\(/.test(fnSrc),
  "edge fn must call redactGovernanceRecord");
check(/_shared\/admin-export-redaction/.test(fnSrc),
  "edge fn must import from _shared/admin-export-redaction");
check(/DEFAULT_REDACTION_MODE/.test(fnSrc),
  "edge fn must use DEFAULT_REDACTION_MODE");
for (const m of [
  "redacted_client_safe",
  "evidence_only",
  "metadata_only",
  "full_internal",
]) {
  check(fnSrc.includes(`"${m}"`),
    `edge fn must accept canonical mode "${m}"`);
}
check(/DATA_010_AUDIT_ACTIONS\.blocked_or_declined/.test(fnSrc),
  "edge fn must emit blocked_or_declined on denial");

// --- Edge function: ABSENT requirements (no IO / mutation / generation) --
const FN_FORBIDDEN = [
  [/\.insert\s*\(/, "edge fn must NOT call .insert()"],
  [/\.update\s*\(/, "edge fn must NOT call .update()"],
  [/\.delete\s*\(/, "edge fn must NOT call .delete()"],
  [/\.upsert\s*\(/, "edge fn must NOT call .upsert()"],
  [/createSignedUrl/, "edge fn must NOT create signed URLs"],
  [/\.storage\b/, "edge fn must NOT touch storage"],
  [/Deno\.writeFile|Deno\.writeTextFile/, "edge fn must NOT write files"],
  [/\bnew\s+Blob\s*\(/, "edge fn must NOT construct Blob output"],
  [/text\/csv/i, "edge fn must NOT emit text/csv"],
  [/application\/pdf/i, "edge fn must NOT emit application/pdf"],
  [/Content-Disposition/i, "edge fn must NOT emit Content-Disposition"],
  [/supabase\.functions\.invoke/, "edge fn must NOT invoke other edge functions"],
  [/admin-governance-export-(prepare|download|destroy)/,
    "edge fn must NOT reference prepare/download/destroy endpoints"],
  [/is_production_environment/, "edge fn must NOT touch Batch 7C production guard"],
  [/RUN_ADMIN_EXPORT_BATCH_7C_SMOKE/, "edge fn must NOT reference Batch 7C confirm phrase"],
  [/org_retention_policies/, "edge fn must NOT touch DATA-004 retention"],
  [/cron\.schedule|net\.http_post/i, "edge fn must NOT touch cron"],
  [/cold-storage-archive/, "edge fn must NOT touch cold-storage"],
];
for (const [re, msg] of FN_FORBIDDEN) {
  if (re.test(fnSrc)) failures.push(msg);
}

// --- Panel: PRESENT requirements -----------------------------------------
check(/data-testid=["']admin-governance-export-preview-panel["']/.test(panelSrc),
  "panel must carry root data-testid");
check(/data-testid=["']badge-preview-only["']/.test(panelSrc),
  "panel must render preview-only badge");
check(/data-testid=["']badge-no-download["']/.test(panelSrc),
  "panel must render no-download badge");
check(/data-testid=["']badge-no-temporary-link["']/.test(panelSrc),
  "panel must render no-temporary-link badge");
check(/data-testid=["']badge-aal2["']/.test(panelSrc),
  "panel must render AAL2 badge");
check(/data-testid=["']preview-redacted["']/.test(panelSrc),
  "panel must render redacted preview container");
check(/data-testid=["']preview-manifest["']/.test(panelSrc),
  "panel must render manifest container");
check(/admin-governance-export-preview/.test(panelSrc),
  "panel must invoke admin-governance-export-preview");
check(/isPlatformAdmin/.test(panelSrc),
  "panel must guard on isPlatformAdmin");

// --- Panel: ABSENT requirements ------------------------------------------
const PANEL_FORBIDDEN = [
  [/admin-governance-export-(prepare|download|destroy)/,
    "panel must NOT invoke prepare/download/destroy"],
  [/admin-governance-export-list/,
    "panel must NOT invoke export-list (separate panel)"],
  [/admin-governance-export-request/,
    "panel must NOT invoke export-request (separate panel)"],
  [/admin-governance-export-approve/,
    "panel must NOT invoke export-approve (separate panel)"],
  [/<a\s+[^>]*download\b/i, "panel must NOT render a download anchor"],
  [/\bnew\s+Blob\s*\(/, "panel must NOT construct Blob"],
  [/URL\.createObjectURL/, "panel must NOT createObjectURL"],
  [/saveAs\s*\(/, "panel must NOT call saveAs()"],
  [/text\/csv/i, "panel must NOT mention text/csv"],
  [/application\/pdf/i, "panel must NOT mention application/pdf"],
  [/Content-Disposition/i, "panel must NOT mention Content-Disposition"],
  [/\bDownload\b/, "panel must NOT render a 'Download' label"],
  [/\bPrepare\b/, "panel must NOT render a 'Prepare' label"],
  [/\bDestroy\b/, "panel must NOT render a 'Destroy' label"],
  [/Ready to download/i, "panel must NOT render 'Ready to download'"],
  [/\bsigned[ _-]?url\b(?!["'])/i, "panel must NOT render user-visible 'signed url' phrase"],
];
for (const [re, msg] of PANEL_FORBIDDEN) {
  if (re.test(panelSrc)) failures.push(msg);
}

// --- Prebuild wiring -----------------------------------------------------
check(
  /check-admin-export-controls-batch-9\.mjs/.test(pkg),
  "package.json prebuild must invoke check-admin-export-controls-batch-9.mjs",
);

if (failures.length) {
  console.error("❌ Admin Export Controls Batch 9 guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("✅ Admin Export Controls Batch 9 guard passed.");
