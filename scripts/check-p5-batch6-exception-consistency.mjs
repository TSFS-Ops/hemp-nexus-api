#!/usr/bin/env node
/**
 * P-5 Batch 6 — Phase 1 SSOT + external-wording drift guard.
 *
 * Phase 1 scope only:
 *   - registry file exists at src/lib/p5-batch6-exception-registry.ts
 *   - all 12 exception types exist
 *   - all 10 review queues exist (incl. unified_operations_inbox)
 *   - all 5 priorities (P0–P4) exist
 *   - all controlled statuses exist (≥21)
 *   - all 13 dispute states exist
 *   - all 10 note types exist
 *   - banned external wording list exists with ≥10 phrases
 *   - banned phrases do NOT appear inside the registry's external-safe
 *     messages
 *   - no Batch 7 route/label tokens have been smuggled in (Phase 1
 *     must not introduce Batch 7 surfaces)
 *
 * Phases 2–6 will extend this guard with UI/route/audit checks.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REGISTRY = resolve(ROOT, "src/lib/p5-batch6-exception-registry.ts");

const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);

if (!existsSync(REGISTRY)) {
  console.error("[check-p5-batch6-exception-consistency] FAIL");
  console.error("  registry file missing:", REGISTRY);
  process.exit(1);
}

const src = readFileSync(REGISTRY, "utf8");

function extractArray(name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`,
  );
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const required = {
  P5_BATCH6_EXCEPTION_TYPES: 12,
  P5_BATCH6_REVIEW_QUEUES: 10,
  P5_BATCH6_PRIORITIES: 5,
  P5_BATCH6_STATUSES: 21,
  P5_BATCH6_DISPUTE_STATES: 13,
  P5_BATCH6_NOTE_TYPES: 10,
  P5_BATCH6_AUDIT_EVENTS: 30,
  P5_BATCH6_REPORTS: 13,
  P5_BATCH6_BANNED_EXTERNAL_WORDING: 10,
  P5_BATCH6_API_SAFE_FIELDS: 10,
  P5_BATCH6_API_SAFE_STATUSES: 10,
  P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS: 15,
};

const extracted = {};
for (const [name, min] of Object.entries(required)) {
  const arr = extractArray(name);
  if (!arr) {
    errors.push(`registry missing export ${name}`);
    continue;
  }
  if (arr.length < min) {
    errors.push(
      `${name} must contain ≥${min} entries (found ${arr.length})`,
    );
  } else {
    ok(`${name} = ${arr.length} entries`);
  }
  extracted[name] = arr;
}

// Required exception type codes (exact match)
const REQUIRED_TYPES = [
  "EVIDENCE_MISSING",
  "EVIDENCE_INVALID_OR_EXPIRED",
  "CONFLICTING_PARTY_INFORMATION",
  "COMPLIANCE_HOLD",
  "FUNDER_REVIEW_EXCEPTION",
  "PROVIDER_DEPENDENCY_FAILURE",
  "PAYMENT_RECONCILIATION_EXCEPTION",
  "MANUAL_OVERRIDE_REQUESTED",
  "DISPUTE_RAISED",
  "FINALITY_BLOCKED",
  "MEMORY_CONFLICT_OR_CORRECTION",
  "SECURITY_OR_ACCESS_EXCEPTION",
];
for (const t of REQUIRED_TYPES) {
  if (!extracted.P5_BATCH6_EXCEPTION_TYPES?.includes(t)) {
    errors.push(`exception type missing: ${t}`);
  }
}

// Required queues
const REQUIRED_QUEUES = [
  "evidence_gap",
  "compliance_exception",
  "funder_escalation",
  "provider_dependency",
  "payment_reconciliation",
  "manual_override_waiver",
  "finality_review",
  "dispute_review",
  "memory_governance",
  "unified_operations_inbox",
];
for (const q of REQUIRED_QUEUES) {
  if (!extracted.P5_BATCH6_REVIEW_QUEUES?.includes(q)) {
    errors.push(`review queue missing: ${q}`);
  }
}

// Required priorities exact
for (const p of ["P0", "P1", "P2", "P3", "P4"]) {
  if (!extracted.P5_BATCH6_PRIORITIES?.includes(p)) {
    errors.push(`priority missing: ${p}`);
  }
}

// Banned wording must not appear inside the registry's external-safe
// messages object.
const safeBlock = src.match(
  /P5_BATCH6_EXTERNAL_SAFE_MESSAGES\s*=\s*\{([\s\S]*?)\}\s*as const/,
);
if (safeBlock) {
  const lower = safeBlock[1].toLowerCase();
  for (const banned of extracted.P5_BATCH6_BANNED_EXTERNAL_WORDING ?? []) {
    if (lower.includes(banned.toLowerCase())) {
      errors.push(
        `external-safe message contains banned phrase "${banned}"`,
      );
    }
  }
} else {
  errors.push("P5_BATCH6_EXTERNAL_SAFE_MESSAGES block not found");
}

// Forbid Batch 7 tokens in Phase 1 — only the registry file is in scope now
const BATCH7_TOKENS = ["p5-batch7", "p5_batch7", "P5_BATCH7", "Batch 7"];
for (const t of BATCH7_TOKENS) {
  if (src.includes(t)) {
    errors.push(`Batch 7 token leaked into registry: "${t}"`);
  }
}

if (errors.length) {
  console.error("[check-p5-batch6-exception-consistency] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("[check-p5-batch6-exception-consistency] OK");
