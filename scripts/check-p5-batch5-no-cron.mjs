#!/usr/bin/env node
/**
 * P-5 Batch 5 — Phase 6 cron-absence guard.
 *
 * Verifies that no Batch 5 migration, edge function or helper introduces
 * pg_cron jobs, cron schedules or scheduled sweeps. C6.2 remains pending,
 * so Batch 5 must remain free of scheduled execution paths.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BANNED = [
  "cron.schedule",
  "pg_cron",
  "cron_job",
  "cron.job",
  "select cron.",
];

const TARGETS = [
  "supabase/migrations/20260625200441_37f8e9ad-f9a2-4561-a95e-6b5ea326e063.sql",
  "supabase/migrations/20260625201007_155a5537-44e9-4af9-ac0e-a0a286141b16.sql",
  "supabase/migrations/20260625202221_b745ddef-8daa-4d0f-95c1-87503e5d6ba2.sql",
];

const SCAN_DIRS = [
  "src/lib/p5-batch5",
  "src/components/p5-batch5",
  "src/pages/admin/p5-batch5",
  "src/pages/desk/p5-batch5",
  "src/pages/funder/p5-batch5",
];

function walk(dir, out) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql|mjs|js)$/.test(e)) out.push(p);
  }
}

const files = [...TARGETS.map((p) => resolve(ROOT, p))];
for (const d of SCAN_DIRS) walk(resolve(ROOT, d), files);

const errors = [];
for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8").toLowerCase(); } catch { continue; }
  for (const phrase of BANNED) {
    if (src.includes(phrase)) {
      errors.push(`${f}: contains banned cron token "${phrase}"`);
    }
  }
}

if (errors.length) {
  console.error("[check-p5-batch5-no-cron] FAIL");
  for (const e of errors) console.error(" -", e);
  console.error(
    "\nC6.2 remains pending. Batch 5 must not introduce cron jobs or scheduled sweeps.",
  );
  process.exit(1);
}
console.log(`[check-p5-batch5-no-cron] OK (${files.length} files scanned)`);
