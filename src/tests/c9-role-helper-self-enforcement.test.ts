/**
 * C9 — has_role self-enforcement static guards.
 *
 * Verifies that the role-helper repair migration:
 *   - enforces self-only checks for authenticated callers
 *   - preserves service-role / NULL-uid backend behaviour
 *   - does not revoke/grant EXECUTE
 *   - does not touch RLS policies or table grants
 *   - leaves has_dd_role alone
 *
 * Also verifies the two frontend RPC call sites pass only `user.id`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION =
  "supabase/migrations/20260630175934_98858f64-342e-48c8-81de-b291316ae215.sql";

const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

describe("C9 role-helper self-enforcement migration", () => {
  it("contains the self-enforcement predicate", () => {
    expect(sql).toMatch(/auth\.uid\(\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/_user_id\s*=\s*auth\.uid\(\)/i);
  });

  it("preserves signature, security definer, stable, search_path", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.has_role\(_user_id uuid, _role app_role\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/\bSTABLE\b/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
    expect(sql).toMatch(/LANGUAGE sql/);
  });

  it("does not revoke or grant EXECUTE", () => {
    expect(sql).not.toMatch(/REVOKE\s+EXECUTE/i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE/i);
  });

  it("does not change RLS policies or tables", () => {
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });

  it("does not touch has_dd_role", () => {
    expect(sql).not.toMatch(/has_dd_role/i);
  });
});

describe("C9 frontend has_role callers are self-only", () => {
  const files = [
    "src/components/MaintenanceBanner.tsx",
    "src/components/facilitation-outreach/useOutreachRoles.ts",
  ];

  for (const f of files) {
    it(`${f} passes only user.id to has_role`, () => {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      // Find every has_role rpc call and assert _user_id is user.id
      const matches = [
        ...src.matchAll(/rpc\(\s*["']has_role["']\s*,\s*\{([^}]*)\}/g),
      ];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const body = m[1];
        expect(body).toMatch(/_user_id\s*:\s*user\.id\b/);
      }
    });
  }
});
