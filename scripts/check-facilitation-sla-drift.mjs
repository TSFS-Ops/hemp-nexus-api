#!/usr/bin/env node
/**
 * Pins SLA helper SSOT — both files must declare matching:
 *   - SLA_BUSINESS_DAY_START_H / SLA_BUSINESS_DAY_END_H
 *   - SLA_RULES keys & values
 *   - OVERDUE_REASON_CODES list
 *   - OVERDUE_REASON_LABELS keys
 *   - FACILITATION_SLA_AUDIT_NAMES list
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = [
  "supabase/functions/_shared/facilitation-sla.ts",
  "src/lib/facilitation-sla.ts",
];

const REQUIRED_TOKENS = [
  "SLA_BUSINESS_DAY_START_H = 9",
  "SLA_BUSINESS_DAY_END_H = 17",
  "owner_assignment_hours: 4",
  "initial_triage_days: 1",
  "more_info_response_days: 5",
  "first_outreach_days: 2",
  "follow_up_outreach_days: 3",
  "unable_to_contact_close_days: 5",
  "compliance_review_days: 2",
  "stale_activity_days: 2",
];

const REQUIRED_REASONS = [
  "owner_assignment_overdue",
  "initial_triage_overdue",
  "more_information_response_overdue",
  "first_outreach_overdue",
  "follow_up_outreach_overdue",
  "compliance_review_overdue",
  "next_action_overdue",
  "stale_no_activity",
];

const REQUIRED_SLA_AUDITS = [
  "facilitation_case.sla_evaluated",
  "facilitation_case.overdue_marked",
  "facilitation_case.overdue_cleared",
  "facilitation_case.reminder_sent",
];

const errors = [];
for (const f of FILES) {
  const path = resolve(ROOT, f);
  if (!existsSync(path)) { errors.push(`Missing: ${f}`); continue; }
  const src = readFileSync(path, "utf8");
  for (const t of REQUIRED_TOKENS) {
    if (!src.includes(t)) errors.push(`${f} missing required token: "${t}"`);
  }
  for (const r of REQUIRED_REASONS) {
    if (!src.includes(`"${r}"`)) errors.push(`${f} missing reason code "${r}"`);
  }
  for (const a of REQUIRED_SLA_AUDITS) {
    if (!src.includes(`"${a}"`)) errors.push(`${f} missing SLA audit name "${a}"`);
  }
}

if (errors.length) {
  console.error("[check-facilitation-sla-drift] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`[check-facilitation-sla-drift] OK (${FILES.length} files pinned)`);
