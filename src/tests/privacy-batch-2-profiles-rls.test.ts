import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = "20260524154944_cf130ab1-c149-4634-918c-66fef7b9834a.sql";
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations", MIGRATION),
  "utf8",
);

describe("Privacy Batch 2 — profiles colleague privacy", () => {
  it("drops the permissive colleague SELECT policy", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Org members can view colleagues in same org" ON public\.profiles/,
    );
  });

  it("drops and replaces the org admin SELECT policy with is_org_admin", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Org admins can view profiles in their org" ON public\.profiles/,
    );
    expect(sql).toMatch(
      /CREATE POLICY "Org admins can view full profiles in their org"[\s\S]*?is_org_admin\(auth\.uid\(\), org_id\)/,
    );
  });

  it("does not touch own-profile SELECT, UPDATE, or platform_admin policies", () => {
    expect(sql).not.toMatch(/DROP POLICY[^;]*"Users can view their own profile"/);
    expect(sql).not.toMatch(/DROP POLICY[^;]*"Users can update their own profile"/);
    expect(sql).not.toMatch(/DROP POLICY[^;]*"Platform admins can manage all profiles"/);
  });

  it("creates org_colleagues_v as SECURITY INVOKER", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE VIEW public\.org_colleagues_v[\s\S]*?security_invoker\s*=\s*true/,
    );
  });

  it("redacted view exposes only safe columns (no email, no deletion metadata)", () => {
    const viewMatch = sql.match(
      /CREATE OR REPLACE VIEW public\.org_colleagues_v[\s\S]*?FROM public\.profiles/,
    );
    expect(viewMatch).not.toBeNull();
    const body = viewMatch![0];
    // Required safe columns
    for (const col of ["p.id", "p.org_id", "p.full_name", "p.status", "p.selected_persona"]) {
      expect(body).toContain(col);
    }
    // Forbidden sensitive columns
    for (const forbidden of [
      "email",
      "deletion_requested_at",
      "deletion_reason",
      "deletion_category",
      "full_name_previous",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("scopes the view by is_same_org(auth.uid(), p.id)", () => {
    expect(sql).toMatch(/is_same_org\(auth\.uid\(\),\s*p\.id\)/);
  });

  it("grants SELECT on the view to authenticated only", () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.org_colleagues_v TO authenticated/);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.org_colleagues_v TO anon/);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.org_colleagues_v TO PUBLIC/);
  });

  it("does not touch poi_engagements, realtime, or other tables", () => {
    expect(sql).not.toMatch(/poi_engagements/i);
    expect(sql).not.toMatch(/supabase_realtime/i);
    expect(sql).not.toMatch(/programme_participants/i);
    expect(sql).not.toMatch(/match_named_contacts/i);
  });

  it("does not drop columns from profiles", () => {
    expect(sql).not.toMatch(/ALTER TABLE[^;]*profiles[^;]*DROP COLUMN/i);
  });
});
