#!/usr/bin/env node
/**
 * DEC-001 / DEC-004 Phase 1 prebuild guard.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-001 (off-platform
 * outreach) and DEC-004 (manual outreach ownership).
 *
 * Asserts:
 *   1. SSOT modules exist and declare the canonical action / state
 *      constants verbatim.
 *   2. The DEC-001 canonical audit names appear (as string literals) in
 *      the live outreach edge function (`supabase/functions/poi-
 *      engagements/index.ts`).
 *   3. The DEC-004 canonical audit names that ARE runtime-emitted appear
 *      in the relevant edge functions (`poi-engagements`, `outreach-sla-
 *      monitor`).
 *   4. `outreach.manual_owner_reassigned` is NOT emitted at runtime (it
 *      may appear only inside the SSOT module / test file / this guard).
 *   5. The forbidden non-owner strings ("vericro", "imperial_tech",
 *      "paystack", etc.) never appear as a manual-outreach owner
 *      assignment in the edge functions.
 *
 * Phase 2 (manual-owner reassignment surface, DB enum widening, new
 * operational states) is intentionally deferred and tested by absence.
 */
import { readFileSync, existsSync } from "node:fs";

const ROOT = process.cwd();

function read(rel) {
  const path = `${ROOT}/${rel}`;
  if (!existsSync(path)) {
    console.error(`❌ DEC-001/004 guard: missing file ${rel}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

// ── 1. SSOT modules ─────────────────────────────────────────────────
const dec001 = read("src/lib/outreach/dec-001-audit.ts");
const dec004 = read("src/lib/outreach/dec-004-states.ts");

const DEC_001_NAMES = [
  "pending_engagement.off_platform_outreach_evaluated",
  "pending_engagement.off_platform_outreach_sent",
  "pending_engagement.off_platform_outreach_blocked",
];

const DEC_004_NAMES = [
  "outreach.manual_follow_up_assigned",
  "outreach.manual_follow_up_action_recorded",
  "outreach.manual_owner_reassigned",
  "outreach.sla_scan_flagged_manual_follow_up",
];

const DEC_004_RUNTIME_NAMES = [
  "outreach.manual_follow_up_assigned",
  "outreach.manual_follow_up_action_recorded",
  "outreach.sla_scan_flagged_manual_follow_up",
];

const DEC_004_CANONICAL_STATES = [
  "first_contact_review_required",
  "contact_details_required",
  "awaiting_outreach",
  "contacted_awaiting_response",
  "reminder_review_required",
  "bounce_review_required",
  "no_response_review_required",
  "dispute_review_required",
  "late_acceptance_review_required",
  "suppressed_test_review_required",
];

const errors = [];

for (const name of DEC_001_NAMES) {
  if (!dec001.includes(`"${name}"`)) {
    errors.push(`SSOT dec-001-audit.ts is missing canonical action: ${name}`);
  }
}
for (const name of DEC_004_NAMES) {
  if (!dec004.includes(`"${name}"`)) {
    errors.push(`SSOT dec-004-states.ts is missing canonical action: ${name}`);
  }
}
for (const state of DEC_004_CANONICAL_STATES) {
  if (!dec004.includes(state)) {
    errors.push(`SSOT dec-004-states.ts is missing canonical state: ${state}`);
  }
}
if (!dec004.includes("DEC_004_MANUAL_OUTREACH_OWNER") || !dec004.includes("izenzo_platform_admin")) {
  errors.push("SSOT dec-004-states.ts is missing the Izenzo manual-outreach owner declaration.");
}
if (!dec004.includes("DEC_004_FORBIDDEN_OUTREACH_OWNERS")) {
  errors.push("SSOT dec-004-states.ts is missing the forbidden-owners list.");
}
if (!dec004.includes("DEC_004_REASSIGNMENT_IMPLEMENTED = false")) {
  errors.push("SSOT dec-004-states.ts must declare DEC_004_REASSIGNMENT_IMPLEMENTED = false (Phase 1).");
}

// ── 2 & 3. Runtime emission proof ───────────────────────────────────
const poi = read("supabase/functions/poi-engagements/index.ts");
const sla = read("supabase/functions/outreach-sla-monitor/index.ts");

for (const name of DEC_001_NAMES) {
  if (!poi.includes(`"${name}"`)) {
    errors.push(`poi-engagements/index.ts does not emit canonical DEC-001 action: ${name}`);
  }
}
for (const name of ["outreach.manual_follow_up_assigned", "outreach.manual_follow_up_action_recorded"]) {
  if (!poi.includes(`"${name}"`)) {
    errors.push(`poi-engagements/index.ts does not emit canonical DEC-004 action: ${name}`);
  }
}
if (!sla.includes(`"outreach.sla_scan_flagged_manual_follow_up"`)) {
  errors.push("outreach-sla-monitor/index.ts does not emit outreach.sla_scan_flagged_manual_follow_up.");
}

// ── 4. Reassignment must NOT be emitted at runtime ──────────────────
for (const file of [
  ["supabase/functions/poi-engagements/index.ts", poi],
  ["supabase/functions/outreach-sla-monitor/index.ts", sla],
]) {
  if (file[1].includes(`"outreach.manual_owner_reassigned"`)) {
    errors.push(
      `${file[0]} emits outreach.manual_owner_reassigned but DEC_004_REASSIGNMENT_IMPLEMENTED=false. Remove or implement the reassignment surface.`,
    );
  }
}

// ── 5. Forbidden non-owner assignment scan ──────────────────────────
const FORBIDDEN_OWNER_PATTERNS = [
  /manual_owner\s*:\s*["'](?:vericro|imperial(?:_tech)?|paystack|stripe|payment_provider)["']/i,
];
for (const file of [
  ["supabase/functions/poi-engagements/index.ts", poi],
  ["supabase/functions/outreach-sla-monitor/index.ts", sla],
]) {
  for (const pat of FORBIDDEN_OWNER_PATTERNS) {
    if (pat.test(file[1])) {
      errors.push(`${file[0]} assigns a forbidden manual-outreach owner (DEC-004).`);
    }
  }
}

if (errors.length > 0) {
  console.error("❌ DEC-001 / DEC-004 Phase 1 guard failed:");
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}

console.log("✅ DEC-001 / DEC-004 Phase 1 guard: SSOT + runtime canonical names verified.");
