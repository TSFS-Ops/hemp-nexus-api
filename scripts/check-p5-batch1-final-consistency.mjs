#!/usr/bin/env node
/**
 * P-5 Batch 1 — Final Embarrassment-Prevention static consistency check.
 *
 * Run from project root:
 *   node scripts/check-p5-batch1-final-consistency.mjs
 *
 * Non-zero exit on any finding.
 *
 * Checks:
 *  - forbidden wording in P-5 customer/funder/api/notification literals
 *  - direct mutation of p5_governance_* tables outside src/lib/p5-governance/rpc.ts
 *  - every reasoned dialog references at least one P-5 reason code
 *  - every status from constants.ts has a label entry
 *  - every status referenced in CasesDashboard FilterKey union exists
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const findings = [];
function fail(msg) {
  findings.push(msg);
}

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/node_modules|dist|\.next|\.git/.test(p)) continue;
      out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------
// 1. Forbidden wording in P-5 non-admin surfaces (string literals only)
// ------------------------------------------------------------------
const FORBIDDEN = [
  "Verified", "Certified", "Compliant", "Sanctions Cleared", "PEP Clear",
  "AML Cleared", "KYC Complete", "Bankable", "Guaranteed Bankable",
  "Guaranteed", "Risk-free", "No risk", "Approved by bank",
  "Approved by funder", "Legally valid", "Audit-proof", "Final settlement",
  "Payment confirmed", "Refund complete", "Without a Doubt", "WaD finality",
];

const EXTERNAL_SOURCES = [
  "src/components/p5-governance/P5ReadinessCard.tsx",
  "src/pages/registry/MyCompanyReadiness.tsx",
  "src/pages/funder/FunderEvidencePack.tsx",
  "src/lib/p5-governance/sla-rules.ts",
];

const STRING_LITERAL = /(["'`])((?:\\.|(?!\1).)*)\1/g;

for (const rel of EXTERNAL_SOURCES) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  for (const m of src.matchAll(STRING_LITERAL)) {
    const lit = m[2];
    const hit = FORBIDDEN.find((w) => lit.toLowerCase().includes(w.toLowerCase()));
    if (hit) fail(`[wording] ${rel}: literal "${lit}" contains forbidden "${hit}"`);
  }
}

// ------------------------------------------------------------------
// 2. Direct mutation bypass of Stage 3 RPCs
// ------------------------------------------------------------------
const SRC = join(ROOT, "src");
for (const path of walk(SRC)) {
  if (!/\.(ts|tsx)$/.test(path)) continue;
  const rel = relative(ROOT, path);
  if (rel.includes("/tests/")) continue;
  if (rel.endsWith("p5-governance/rpc.ts")) continue;
  const src = readFileSync(path, "utf8");
  if (!/p5_governance_(readiness_cases|evidence_items|audit_events)/.test(src)) continue;
  const fromBlock =
    /\.from\(\s*["']p5_governance_(?:readiness_cases|evidence_items|audit_events)["']\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\s*\(/;
  if (fromBlock.test(src)) fail(`[mutation] ${rel} writes to p5_governance_* directly`);
}

// ------------------------------------------------------------------
// 3. Reasoned dialogs reference reason codes
// ------------------------------------------------------------------
const DIALOG_DIR = "src/pages/admin/p5-governance/components/dialogs";
for (const f of readdirSync(join(ROOT, DIALOG_DIR))) {
  if (f === "ReasonedActionDialog.tsx") continue;
  const src = readFileSync(join(ROOT, DIALOG_DIR, f), "utf8");
  if (!/reasonCodes|HOLD_REASON_CODES/.test(src)) {
    fail(`[reason-codes] ${DIALOG_DIR}/${f} does not expose a reason-code list`);
  }
}

// ------------------------------------------------------------------
// 4. Status SSOT label coverage (parse constants.ts naively)
// ------------------------------------------------------------------
const constants = readFileSync(
  join(ROOT, "src/lib/p5-governance/constants.ts"),
  "utf8",
);
const statusMatch = constants.match(
  /P5_STATUSES = \[([\s\S]*?)\] as const;/,
);
const labelMatch = constants.match(
  /P5_STATUS_LABELS:\s*Record<P5Status,\s*string>\s*=\s*\{([\s\S]*?)\};/,
);
if (!statusMatch || !labelMatch) {
  fail("[status] could not parse P5_STATUSES / P5_STATUS_LABELS from constants.ts");
} else {
  const statuses = Array.from(statusMatch[1].matchAll(/"([a-z_]+)"/g), (m) => m[1]);
  for (const s of statuses) {
    if (!new RegExp(`\\b${s}:\\s*["']`).test(labelMatch[1])) {
      fail(`[status] missing label for status "${s}" in P5_STATUS_LABELS`);
    }
  }
}

// ------------------------------------------------------------------
// 5. Dashboard FilterKey union completeness
// ------------------------------------------------------------------
const dash = readFileSync(
  join(ROOT, "src/pages/admin/p5-governance/CasesDashboard.tsx"),
  "utf8",
);
for (const k of [
  "blockers", "warnings", "provider_dependent", "on_hold", "escalated",
  "overdue", "ready_to_proceed", "more_information_required",
  "assigned_to_me", "unassigned", "provider_failed",
  "provider_credentials_pending",
]) {
  if (!dash.includes(`"${k}"`)) fail(`[dashboard] filter key "${k}" missing`);
}

// ------------------------------------------------------------------
if (findings.length === 0) {
  console.log("P5_BATCH_1_FINAL_CONSISTENCY_OK");
  process.exit(0);
} else {
  console.error(`P5_BATCH_1_FINAL_CONSISTENCY_FAIL (${findings.length} finding(s)):`);
  for (const f of findings) console.error(" - " + f);
  process.exit(1);
}
