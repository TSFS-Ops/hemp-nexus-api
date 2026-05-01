/**
 * RBAC Stage 3G — Test-Mode Bypass Production Lockout.
 *
 * Verifies (via static source inspection — CI-safe) that:
 *   - The edge helper `_shared/test-mode-bypass.ts` exports `isProductionTier`
 *     and consults it before honouring any bypass.
 *   - When production lockout fires, an audit row is written
 *     (`test_mode.production_lockout_denied`).
 *   - The DB RPC `is_test_mode_bypass_enabled` is hardened with
 *     `is_production_environment()`.
 *   - The admin panel exposes a clear production-lockout banner and tells
 *     operators that production overrides must use break-glass instead.
 *   - The shared helper carries the stable error reason
 *     `test_mode_bypass_locked_in_production`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SHARED = join(
  process.cwd(),
  'supabase',
  'functions',
  '_shared',
  'test-mode-bypass.ts',
);
const PANEL = join(
  process.cwd(),
  'src',
  'components',
  'admin',
  'TestModeBypassPanel.tsx',
);
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

describe('RBAC Stage 3G: edge-layer production lockout', () => {
  const src = readFileSync(SHARED, 'utf8');

  it('exports isProductionTier so tests and call-sites can detect it', () => {
    expect(src).toMatch(/export function isProductionTier\s*\(/);
  });

  it('checks ENVIRONMENT_TIER for production / live / prod', () => {
    expect(src).toMatch(/ENVIRONMENT_TIER/);
    expect(src).toMatch(/"production"|'production'/);
    expect(src).toMatch(/"live"|'live'/);
    expect(src).toMatch(/"prod"|'prod'/);
  });

  it('isBypassEnabled short-circuits when isProductionTier() is true', () => {
    // The lockout branch must call isProductionTier() and return false.
    expect(src).toMatch(/if\s*\(\s*isProductionTier\(\)\s*\)\s*\{[\s\S]*return false/);
  });

  it('writes a production_lockout_denied audit row when lockout fires', () => {
    expect(src).toMatch(/test_mode\.production_lockout_denied/);
  });

  it('exposes a stable break-glass guidance reason', () => {
    expect(src).toMatch(/PRODUCTION_LOCKOUT_REASON/);
    expect(src).toMatch(/break-glass.*second-approval|second-approval.*break-glass/i);
  });
});

describe('RBAC Stage 3G: DB-layer production lockout', () => {
  function findStage3gMigration(): string {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse();
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      // Stricter heuristic (2026-05-01): require the actual function body to
      // be defined in this migration, not just a textual mention. Later
      // migrations (e.g. SECDEF Stage D1 grant lockdown) reference both
      // function names but do not redefine them.
      if (
        /CREATE OR REPLACE FUNCTION public\.is_production_environment/.test(sql) &&
        /CREATE OR REPLACE FUNCTION public\.is_test_mode_bypass_enabled/.test(sql)
      ) {
        return sql;
      }
    }
    throw new Error('No migration adds is_production_environment + hardened bypass RPC');
  }

  const sql = findStage3gMigration();

  it('adds is_production_environment() helper', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_production_environment/);
  });

  it('hardens is_test_mode_bypass_enabled with production lockout', () => {
    // The function body must consult is_production_environment().
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_test_mode_bypass_enabled/);
    expect(sql).toMatch(/NOT\s+public\.is_production_environment\(\)/);
  });

  it('seeds environment tier defaulting to sandbox (no behaviour change)', () => {
    expect(sql).toMatch(/INSERT INTO public\.admin_settings[\s\S]*'environment'/);
    expect(sql).toMatch(/'tier',\s*'sandbox'/);
  });

  it('exposes get_test_mode_lockout_state() for the admin UI', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_test_mode_lockout_state/);
    expect(sql).toMatch(/'production_locked'/);
  });
});

describe('RBAC Stage 3G: admin UI surfaces lockout + break-glass guidance', () => {
  const panel = readFileSync(PANEL, 'utf8');

  it('reads lockout state from get_test_mode_lockout_state RPC', () => {
    expect(panel).toMatch(/get_test_mode_lockout_state/);
  });

  it('renders a production-lockout banner when locked', () => {
    expect(panel).toMatch(/test-mode-production-lockout-banner/);
    expect(panel).toMatch(/Production lockout active/);
  });

  it('clearly labels the panel as sandbox / test only', () => {
    expect(panel).toMatch(/sandbox \/ test only/);
  });

  it('directs production operators to break-glass / second approval', () => {
    expect(panel).toMatch(/break-glass.*second-approval|second-approval.*break-glass/i);
  });

  it('states that test-mode bypass is not a production override', () => {
    expect(panel).toMatch(/not a production override/i);
  });
});
