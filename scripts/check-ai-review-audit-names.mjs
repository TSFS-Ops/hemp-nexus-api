#!/usr/bin/env node
/**
 * AI Counterparty Intelligence & Match Review — audit-name SSOT guard.
 *
 * Pins canonical `ai_review.*` action codes across:
 *   - supabase/functions/_shared/ai-review-audit.ts  (Deno SSOT)
 *   - src/lib/ai-review/audit-names.ts               (browser mirror)
 *
 * Also forbids any inline `ai_review.<something>` literal that is NOT in
 * the canonical list, anywhere under supabase/functions/ai-* or
 * src/lib/ai-review.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQUIRED = [
  "ai_review.trade_request_interpreted",
  "ai_review.counterparty_sourced",
  "ai_review.counterparty_ranked",
  "ai_review.proposed_match_created",
  "ai_review.proposed_match_reviewed",
  "ai_review.proposed_match_approved",
  "ai_review.proposed_match_rejected",
  "ai_review.proposed_match_archived",
  "ai_review.proposed_match_escalated",
  "ai_review.proposed_match_needs_more_research",
  "ai_review.confidence_overridden",
  "ai_review.outreach_draft_created",
  "ai_review.outreach_draft_edited",
  "ai_review.outreach_draft_approved",
  "ai_review.outreach_sent_by_human",
  "ai_review.outreach_draft_rejected",
  "ai_review.poi_intelligence_created",
  "ai_review.risk_flag_added",
  "ai_review.escalation_created",
  "ai_review.admin_override_applied",
  "ai_review.do_not_contact_rule_created",
  "ai_review.do_not_contact_rule_deactivated",
];

const SSOT_FILES = [
  "supabase/functions/_shared/ai-review-audit.ts",
  "src/lib/ai-review/audit-names.ts",
];

const errors = [];

for (const f of SSOT_FILES) {
  const path = resolve(ROOT, f);
  if (!existsSync(path)) {
    errors.push(`Missing SSOT file: ${f}`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) {
      errors.push(`${f} missing canonical audit name "${name}"`);
    }
  }
}

// Forbid stray ai_review.* literals not in canonical list
const SCAN_ROOTS = ["supabase/functions", "src/lib/ai-review", "src/components/admin"];
const literalRe = /"ai_review\.[a-z_]+"/g;
const allow = new Set(REQUIRED.map((n) => `"${n}"`));

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(resolve(ROOT, root))) {
    const src = readFileSync(file, "utf8");
    const matches = src.match(literalRe) ?? [];
    for (const m of matches) {
      if (!allow.has(m)) {
        errors.push(`${file}: non-canonical audit literal ${m}`);
      }
    }
  }
}

if (errors.length) {
  console.error("[check-ai-review-audit-names] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`[check-ai-review-audit-names] OK (${REQUIRED.length} canonical names pinned)`);
