#!/usr/bin/env node
/**
 * DATA-004 Batch 9A — cold-storage-archive scheduled-dry-run guard.
 *
 * Pins:
 *   (1) At least one SQL migration schedules a job named
 *       'cold-storage-archive-dryrun'.
 *   (2) That schedule pins `dry_run: true` in the body and never sets
 *       `dry_run: false`.
 *   (3) That schedule authenticates with `x-internal-key` sourced from
 *       the `INTERNAL_CRON_KEY` vault secret — never an anon Bearer.
 *   (4) The scheduled URL points at the Batch 7 edge function
 *       `/functions/v1/cold-storage-archive` — never a legacy DB
 *       function.
 *   (5) No SQL migration schedules a live (non-`-dryrun`) cold-storage
 *       jobname.
 *   (6) No SQL migration schedules `cold-storage-archive-weekly`
 *       (quarantined in Batch 8A).
 *   (7) `cold-storage-archive` source still defaults `dry_run` to TRUE
 *       and contains no `.delete(` call (Batch 7 contract preserved).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const FN = resolve(ROOT, "supabase/functions/cold-storage-archive/index.ts");

const errors = [];

function walkSql(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSql(p));
    else if (p.endsWith(".sql")) out.push(p);
  }
  return out;
}
function stripSql(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return out
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
}

let dryRunMatches = 0;
const SCHED_RE = /cron\.schedule\s*\(\s*['"`]([a-z0-9._-]+)['"`][\s\S]*?(?=cron\.schedule\s*\(|$)/gi;

for (const f of walkSql(MIG_DIR)) {
  const code = stripSql(readFileSync(f, "utf8"));
  if (!code.includes("cold-storage-archive") && !code.includes("cold-storage-archive-weekly")) continue;

  // (6) weekly jobname remains quarantined
  if (/cron\.schedule\s*\(\s*['"`]cold-storage-archive-weekly['"`]/i.test(code)) {
    errors.push(`${f}: Batch 8A — 'cold-storage-archive-weekly' is quarantined and must not be scheduled.`);
  }

  for (const m of code.matchAll(SCHED_RE)) {
    const block = m[0];
    const jobname = m[1];
    if (!/cold-storage-archive/i.test(block)) continue;

    // (5) only `-dryrun` jobname permitted
    if (jobname !== "cold-storage-archive-dryrun") {
      errors.push(`${f}: only 'cold-storage-archive-dryrun' may be scheduled (got '${jobname}').`);
      continue;
    }

    dryRunMatches += 1;

    // (2) dry_run pin
    if (!/['"]dry_run['"]\s*,\s*true\b/i.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must pin 'dry_run', true.`);
    }
    if (/['"]dry_run['"]\s*,\s*false\b/i.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must NOT set dry_run=false.`);
    }
    // (3) auth = x-internal-key + INTERNAL_CRON_KEY (never anon Bearer)
    if (/Authorization['"]\s*,\s*['"]Bearer\s+ey/i.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must NOT use anon Bearer auth.`);
    }
    if (!/x-internal-key/i.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must send x-internal-key header.`);
    }
    if (!/INTERNAL_CRON_KEY/.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must read INTERNAL_CRON_KEY from vault.`);
    }
    // (4) target the Batch 7 edge function, not a legacy DB function
    if (!/\/functions\/v1\/cold-storage-archive/.test(block)) {
      errors.push(`${f}: 'cold-storage-archive-dryrun' must POST to /functions/v1/cold-storage-archive.`);
    }
  }
}

// (1) exactly one dry-run schedule across migrations
if (dryRunMatches === 0) {
  errors.push("no migration schedules 'cold-storage-archive-dryrun' (Batch 9A requires the dry-run schedule).");
} else if (dryRunMatches > 1) {
  errors.push(`Batch 9A allows exactly one 'cold-storage-archive-dryrun' schedule (found ${dryRunMatches}).`);
}

// (7) Batch 7 source contract preserved
if (!existsSync(FN)) {
  errors.push(`missing source: ${FN}`);
} else {
  const src = readFileSync(FN, "utf8");
  if (!/body\.dry_run\s*!==\s*false/.test(src)) {
    errors.push("cold-storage-archive: dry_run default must coerce to TRUE.");
  }
  if (/\.delete\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) {
    errors.push("cold-storage-archive: '.delete(' is forbidden — must never delete source records.");
  }
}

if (errors.length) {
  console.error("✗ DATA-004 Batch 9A cold-storage scheduled-dry-run guard FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ DATA-004 Batch 9A cold-storage-archive scheduled dry-run guard OK.");
