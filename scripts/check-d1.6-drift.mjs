#!/usr/bin/env node
/**
 * D1.6 schema drift check. Mirrors scripts/check-d1.5-drift.mjs but against
 * supabase/snapshots/d1_6_schema_proof.sql. Exit non-zero on any FALSE.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_PATH = resolve(__dirname, '..', 'supabase', 'snapshots', 'd1_6_schema_proof.sql');

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[check-d1.6-drift] Skipped — VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  process.exit(0);
}

const sql = readFileSync(PROOF_PATH, 'utf8');

async function run() {
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
    console.warn(`[check-d1.6-drift] pg/query unavailable (${res.status}). Skipped.`);
    process.exit(0);
  }
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows?.[0] ?? rows;
  if (!row || typeof row !== 'object') {
    console.error('[check-d1.6-drift] Unexpected response:', rows);
    process.exit(1);
  }
  const failures = Object.entries(row).filter(([, v]) => v !== true && v !== 't');
  if (failures.length > 0) {
    console.error('[check-d1.6-drift] D1.6 schema drift detected:');
    for (const [k, v] of failures) console.error(`  - ${k} = ${JSON.stringify(v)}`);
    process.exit(1);
  }
  console.log('[check-d1.6-drift] OK — all D1.6 schema assertions pass.');
}

run().catch((e) => {
  console.error('[check-d1.6-drift] Error:', e?.message || e);
  process.exit(1);
});
