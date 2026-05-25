/**
 * Static wiring guard for the admin-credit-org follow-up (Batch F1 atomicity).
 *
 * Asserts:
 *   1. AdminTokenManagement.tsx invokes the admin-credit-org edge function.
 *   2. AdminTokenManagement.tsx no longer calls atomic_token_credit directly
 *      via supabase.rpc().
 *   3. The edge function source declares the 10,000 credit cap and uses
 *      has_role for RBAC.
 *   4. Batch F1: the edge function calls the atomic wrapper RPC
 *      `admin_credit_org_with_governance` and does NOT split credit and
 *      governance into two separate calls (no rpc('atomic_token_credit'),
 *      no post-mutation recordAdminHqDecision import).
 *
 * If anyone re-introduces the credit-then-governance sequence (which is
 * the gap Batch F1 exists to close), this test fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_UI_PATH = resolve(
  __dirname,
  '../components/admin/AdminTokenManagement.tsx',
);
const EDGE_FN_PATH = resolve(
  __dirname,
  '../../supabase/functions/admin-credit-org/index.ts',
);

const adminUiSource = readFileSync(ADMIN_UI_PATH, 'utf8');
const edgeFnSource = readFileSync(EDGE_FN_PATH, 'utf8');

describe('admin-credit-org wiring', () => {
  it('AdminTokenManagement invokes admin-credit-org via supabase.functions.invoke', () => {
    expect(adminUiSource).toMatch(
      /supabase\s*\.\s*functions\s*\.\s*invoke\s*\(\s*["']admin-credit-org["']/,
    );
  });

  it('AdminTokenManagement does not call atomic_token_credit via rpc()', () => {
    const rpcCallRegex = /\.rpc\s*\(\s*["']atomic_token_credit["']/;
    expect(rpcCallRegex.test(adminUiSource)).toBe(false);
  });

  it('admin-credit-org edge function declares the 10,000 credit cap', () => {
    expect(edgeFnSource).toMatch(/MAX_CREDITS_PER_CALL\s*=\s*10[_,]?000/);
    expect(edgeFnSource).toMatch(/\.max\(\s*MAX_CREDITS_PER_CALL/);
  });

  it('admin-credit-org edge function uses has_role for RBAC', () => {
    expect(edgeFnSource).toMatch(/rpc\(\s*['"]has_role['"]/);
    expect(edgeFnSource).toMatch(/_role:\s*['"]platform_admin['"]/);
  });

  it('admin-credit-org edge function writes legacy admin audit logs', () => {
    expect(edgeFnSource).toMatch(/admin_audit_logs/);
    expect(edgeFnSource).toMatch(/action:\s*['"]admin\.credit_org['"]/);
  });

  // ── Batch F1: atomic credit + governance ──────────────────────────────
  it('F1: edge function calls the atomic admin_credit_org_with_governance RPC', () => {
    expect(edgeFnSource).toMatch(
      /\.rpc\(\s*[\n\s]*['"]admin_credit_org_with_governance['"]/,
    );
  });

  it('F1: edge function no longer calls atomic_token_credit directly', () => {
    // The atomic wrapper RPC calls atomic_token_credit internally; the edge
    // function itself must not, otherwise we recreate the split commit gap.
    expect(edgeFnSource).not.toMatch(
      /\.rpc\(\s*[\n\s]*['"]atomic_token_credit['"]/,
    );
  });

  it('F1: edge function does not import recordAdminHqDecision (atomic RPC writes governance)', () => {
    expect(edgeFnSource).not.toMatch(
      /^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m,
    );
  });

  it('F1: edge function does not call recordAdminHqDecision after the mutation', () => {
    expect(edgeFnSource).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it('F1: edge function surfaces governance_event_id from the atomic RPC', () => {
    expect(edgeFnSource).toMatch(/governance_event_id/);
  });
});

