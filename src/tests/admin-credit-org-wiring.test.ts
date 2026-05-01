/**
 * Static wiring guard for the admin-credit-org follow-up.
 *
 * Asserts:
 *   1. AdminTokenManagement.tsx invokes the admin-credit-org edge function.
 *   2. AdminTokenManagement.tsx no longer calls atomic_token_credit directly
 *      via supabase.rpc(). (Comments mentioning the function are allowed —
 *      we only ban active rpc() invocations.)
 *   3. The edge function source declares the 10,000 credit cap.
 *
 * This test is the canary that proves the Stage C admin-top-up follow-up
 * stayed in place. If anyone re-introduces a direct rpc('atomic_token_credit')
 * call from an authenticated client surface, this test fails.
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
    // Allow comments referencing the name, ban actual rpc invocations.
    const rpcCallRegex = /\.rpc\s*\(\s*["']atomic_token_credit["']/;
    expect(rpcCallRegex.test(adminUiSource)).toBe(false);
  });

  it('admin-credit-org edge function declares the 10,000 credit cap', () => {
    expect(edgeFnSource).toMatch(/MAX_CREDITS_PER_CALL\s*=\s*10[_,]?000/);
    // Cap must also be enforced via Zod .max
    expect(edgeFnSource).toMatch(/\.max\(\s*MAX_CREDITS_PER_CALL/);
  });

  it('admin-credit-org edge function uses has_role for RBAC', () => {
    expect(edgeFnSource).toMatch(/rpc\(\s*['"]has_role['"]/);
    expect(edgeFnSource).toMatch(/_role:\s*['"]platform_admin['"]/);
  });

  it('admin-credit-org edge function calls atomic_token_credit under service-role', () => {
    expect(edgeFnSource).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(edgeFnSource).toMatch(/rpc\(\s*[\n\s]*['"]atomic_token_credit['"]/);
  });

  it('admin-credit-org edge function writes admin audit logs', () => {
    expect(edgeFnSource).toMatch(/admin_audit_logs/);
    expect(edgeFnSource).toMatch(/action:\s*['"]admin\.credit_org['"]/);
  });
});
