#!/usr/bin/env node
/**
 * P011 — Counterparty rating audit-name SSOT guard.
 * Pins the 12 canonical `counterparty_rating.*` action codes and forbids
 * any drifted `counterparty_rating.<other>` literal anywhere in the
 * compute or override edge functions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REQUIRED = [
  "counterparty_rating.rating_calculated",
  "counterparty_rating.rating_refreshed",
  "counterparty_rating.rating_changed",
  "counterparty_rating.rating_marked_stale",
  "counterparty_rating.rating_flag_added",
  "counterparty_rating.rating_flag_removed",
  "counterparty_rating.rating_viewed_by_admin",
  "counterparty_rating.rating_override_applied",
  "counterparty_rating.rating_override_changed",
  "counterparty_rating.rating_override_removed",
  "counterparty_rating.rating_recalculation_failed",
  "counterparty_rating.methodology_version_changed",
];

const ssotFiles = [
  resolve("src/lib/evidence-rating.ts"),
  resolve("supabase/functions/_shared/evidence-rating.ts"),
];

const scanFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) scanFiles.push(p);
  }
}
walk(resolve("supabase/functions/compute-evidence-rating"));
walk(resolve("supabase/functions/evidence-rating-override"));

const errors = [];
for (const f of ssotFiles) {
  const src = readFileSync(f, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) errors.push(`${f}: missing canonical name ${name}`);
  }
}

const ALLOWED = new Set(REQUIRED);
const LITERAL = /"counterparty_rating\.[a-z0-9_]+"/g;
for (const f of scanFiles) {
  const src = readFileSync(f, "utf8");
  const matches = src.match(LITERAL) ?? [];
  for (const m of matches) {
    const bare = m.slice(1, -1);
    if (!ALLOWED.has(bare)) errors.push(`${f}: drifted audit name ${m}`);
  }
}

if (errors.length) {
  console.error("[check-counterparty-rating-audit-names] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log(`[check-counterparty-rating-audit-names] OK (${REQUIRED.length} canonical names)`);
