#!/usr/bin/env node
/**
 * DATA-004 Batch 12 — Live Cron Drift Monitor read-only guard.
 *
 * Asserts:
 *  - The drift RPC public.data_004_cron_drift_check is defined as
 *    SECURITY DEFINER, STABLE, with explicit search_path, and is granted
 *    EXECUTE only to service_role (revokes from public/anon/authenticated).
 *  - The migration body contains zero cron mutation verbs: no
 *    cron.schedule(, no cron.unschedule(, no UPDATE/DELETE/INSERT against
 *    cron.* tables, no net.http_post( call.
 *  - The admin-org-retention edge function exposes the cron_drift surface
 *    via the existing health action and never calls cron.schedule or
 *    cron.unschedule.
 *  - RELEASE_GATE.md and docs/launch-runbook.md carry a DATA-004 Batch 12
 *    section that contains the verbatim phrases "read-only" and
 *    "does not modify cron state".
 *
 * This guard inspects code, migrations, and docs — it does NOT query
 * live cron state. Operators must continue to inspect cron.job directly
 * (the drift monitor is the runtime control for that).
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const errors = [];

function readFile(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

// 1. Locate the Batch 12 migration.
const migrationsDir = path.join(repoRoot, "supabase/migrations");
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
const batch12 = migrations
  .map((f) => ({ f, body: readFile(`supabase/migrations/${f}`) }))
  .find((m) => /data_004_cron_drift_check/i.test(m.body));

if (!batch12) {
  errors.push("Missing migration that defines public.data_004_cron_drift_check.");
} else {
  const body = batch12.body;
  const required = [
    /create or replace function public\.data_004_cron_drift_check\s*\(\s*\)/i,
    /security definer/i,
    /\bstable\b/i,
    /set\s+search_path\s*=\s*public\s*,\s*cron/i,
    /revoke\s+all\s+on\s+function\s+public\.data_004_cron_drift_check\s*\(\s*\)\s+from\s+public/i,
    /revoke\s+all\s+on\s+function\s+public\.data_004_cron_drift_check\s*\(\s*\)\s+from\s+anon/i,
    /revoke\s+all\s+on\s+function\s+public\.data_004_cron_drift_check\s*\(\s*\)\s+from\s+authenticated/i,
    /grant\s+execute\s+on\s+function\s+public\.data_004_cron_drift_check\s*\(\s*\)\s+to\s+service_role/i,
  ];
  for (const re of required) {
    if (!re.test(body)) errors.push(`Batch 12 migration missing required clause: ${re}`);
  }
  // Forbid any mutation against cron.* or any unschedule/schedule/http_post.
  const forbidden = [
    /cron\.schedule\s*\(/i,
    /cron\.unschedule\s*\(/i,
    /net\.http_post\s*\(/i,
    /\bupdate\s+cron\./i,
    /\bdelete\s+from\s+cron\./i,
    /\binsert\s+into\s+cron\./i,
  ];
  for (const re of forbidden) {
    if (re.test(body)) errors.push(`Batch 12 migration contains forbidden cron-mutation clause: ${re}`);
  }
}

// 2. Edge function — admin-org-retention must call the drift RPC and must
//    not contain cron-mutation calls.
const edgePath = "supabase/functions/admin-org-retention/index.ts";
const edge = readFile(edgePath);
if (!/data_004_cron_drift_check/.test(edge)) {
  errors.push(`${edgePath} must call rpc("data_004_cron_drift_check") to surface drift in health.`);
}
if (/cron\.schedule\b|cron\.unschedule\b/.test(edge)) {
  errors.push(`${edgePath} must not reference cron.schedule / cron.unschedule (Batch 12 is read-only).`);
}

// 3. Docs must carry a Batch 12 read-only declaration.
const docsTargets = ["RELEASE_GATE.md", "docs/launch-runbook.md"];
for (const rel of docsTargets) {
  const body = readFile(rel);
  if (!/DATA-004 Batch 12/.test(body)) {
    errors.push(`${rel} must carry a DATA-004 Batch 12 section.`);
    continue;
  }
  // Extract the Batch 12 section (up to the next top-level "## DATA-004" or EOF).
  const m = body.match(/## DATA-004 Batch 12[\s\S]*?(?=\n## DATA-004|\n## [A-Z]|$)/);
  const section = m ? m[0] : "";
  if (!/read-only/i.test(section)) errors.push(`${rel} Batch 12 section must contain the phrase "read-only".`);
  if (!/does not modify cron state/i.test(section)) {
    errors.push(`${rel} Batch 12 section must contain the verbatim phrase "does not modify cron state".`);
  }
}

if (errors.length) {
  console.error("DATA-004 Batch 12 guard FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("DATA-004 Batch 12 guard OK — drift monitor is read-only and declared in docs.");
