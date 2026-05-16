#!/usr/bin/env node
/**
 * Batch H — FX drift guard.
 *
 * The legacy `_shared/fx.ts` module (USD→ZAR rate fetcher, exchangerate.host)
 * was retired from live checkout on 2026-05-01 when Paystack switched to
 * USD-native settlement. The file is intentionally retained for historical
 * reporting/reconciliation only and MUST NOT be imported by any edge
 * function that participates in checkout, webhooks, ledger writes, or
 * customer-facing pricing.
 *
 * This guard fails the build if any edge function under
 * `supabase/functions/` imports `_shared/fx` or `../_shared/fx.ts`. If you
 * legitimately need historical FX data, add the file path to ALLOW below.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'supabase', 'functions');
const ALLOW = new Set([
  // The module itself.
  'supabase/functions/_shared/fx.ts',
]);

const IMPORT_PATTERNS = [
  /from\s+['"][^'"]*_shared\/fx(?:\.ts)?['"]/,
  /import\s*\(\s*['"][^'"]*_shared\/fx(?:\.ts)?['"]/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  if (ALLOW.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (IMPORT_PATTERNS.some((re) => re.test(src))) {
    offenders.push(rel);
  }
}

if (offenders.length > 0) {
  console.error('[check-fx-no-importers] FX drift detected — `_shared/fx.ts` must not be imported by live checkout/payment code.');
  for (const o of offenders) console.error('  - ' + o);
  console.error('\nIf this import is for historical reporting only, add the path to ALLOW in scripts/check-fx-no-importers.mjs.');
  process.exit(1);
}

console.log('[check-fx-no-importers] OK — no live importers of _shared/fx.ts');
