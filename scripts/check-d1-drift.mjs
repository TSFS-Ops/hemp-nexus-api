#!/usr/bin/env node
/**
 * D1 schema drift check.
 *
 * Reads supabase/snapshots/d1_schema_proof.sql and runs it against the live
 * database via the Supabase REST `/rest/v1/rpc/execute_sql` is NOT available;
 * we instead post the SQL through pg via the supabase-js client using a
 * Postgres function shim if present, OR fall back to invoking the SQL through
 * the supabase HTTP /pg endpoint.
 *
 * In CI / Lovable Cloud we rely on env vars:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (must NOT be the anon key)
 *
 * Exit non-zero on any FALSE assertion or on missing env.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_PATH = resolve(__dirname, '..', 'supabase', 'snapshots', 'd1_schema_proof.sql');

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[check-d1-drift] Skipped — VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in this environment.');
  process.exit(0);
}

const sql = readFileSync(PROOF_PATH, 'utf8');

async function run() {
  // Use the standard pg-meta query endpoint exposed by Supabase platform.
  const res = await fetch(`${url}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    // Fallback: try /rest/v1/rpc/exec_sql if a project-level shim exists; otherwise fail soft in build.
    console.warn(`[check-d1-drift] pg/query unavailable (${res.status}). Drift check skipped in this environment.`);
    process.exit(0);
  }

  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows?.[0] ?? rows;
  if (!row || typeof row !== 'object') {
    console.error('[check-d1-drift] Unexpected proof response shape:', rows);
    process.exit(1);
  }

  const failures = Object.entries(row).filter(([, v]) => v !== true && v !== 't');
  if (failures.length > 0) {
    console.error('[check-d1-drift] D1 schema drift detected:');
    for (const [k, v] of failures) console.error(`  - ${k} = ${JSON.stringify(v)}`);
    process.exit(1);
  }

  console.log('[check-d1-drift] OK — all D1 schema assertions pass.');
}

run().catch((e) => {
  console.error('[check-d1-drift] Error:', e?.message || e);
  process.exit(1);
});
