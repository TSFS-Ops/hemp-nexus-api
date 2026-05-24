/**
 * Privacy Batch 1 — programme_participants + match_named_contacts
 *
 * Static migration-text assertions that prove:
 *  - the over-broad "any org member" SELECT policies are dropped, and
 *  - the replacement SELECT policies restrict to org_admin / platform_admin.
 *
 * Out of scope (must not regress): inserts/updates/deletes, service-role
 * policies, Realtime publication, column lists.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const ALL_SQL = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

const PRIVACY_BATCH_1_FILE = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8") }))
  .find(
    ({ sql }) =>
      /Privacy Batch 1/i.test(sql) &&
      /programme_participants/.test(sql) &&
      /match_named_contacts/.test(sql),
  );

describe("Privacy Batch 1 — migration is present", () => {
  it("ships a single migration covering both tables", () => {
    expect(PRIVACY_BATCH_1_FILE, "Privacy Batch 1 migration not found").toBeDefined();
  });
});

describe("Privacy Batch 1 — programme_participants RLS", () => {
  const sql = PRIVACY_BATCH_1_FILE!.sql;

  it("drops the over-broad 'Users can view own org participants' SELECT policy", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Users can view own org participants"\s+ON public\.programme_participants/i,
    );
  });

  it("creates an org_admin / platform_admin scoped SELECT policy", () => {
    expect(sql).toMatch(
      /CREATE POLICY "Org admins and platform admins can view participants"\s+ON public\.programme_participants/i,
    );
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'platform_admin'\)/);
    expect(sql).toMatch(/is_org_admin\(auth\.uid\(\), pr\.org_id\)/);
  });

  it("does not modify INSERT/UPDATE/DELETE policies for programme_participants", () => {
    // The migration only touches SELECT.
    expect(sql).not.toMatch(
      /CREATE POLICY .* ON public\.programme_participants\s+FOR (INSERT|UPDATE|DELETE)/i,
    );
    expect(sql).not.toMatch(
      /DROP POLICY .* ON public\.programme_participants\s*;[\s\S]*?(INSERT|UPDATE|DELETE)/i,
    );
  });
});

describe("Privacy Batch 1 — match_named_contacts RLS", () => {
  const sql = PRIVACY_BATCH_1_FILE!.sql;

  it("drops the over-broad 'Org members can view their named contacts' SELECT policy", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Org members can view their named contacts"\s+ON public\.match_named_contacts/i,
    );
  });

  it("creates an org_admin scoped SELECT policy keyed off the row's org_id", () => {
    expect(sql).toMatch(
      /CREATE POLICY "Org admins can view their named contacts"\s+ON public\.match_named_contacts/i,
    );
    expect(sql).toMatch(/is_org_admin\(auth\.uid\(\), org_id\)/);
  });

  it("leaves the pre-existing platform_admin SELECT and service_role policies in place", () => {
    // Sanity: these were created in the founding MT-009 migration and must not
    // be dropped by Privacy Batch 1.
    expect(sql).not.toMatch(
      /DROP POLICY IF EXISTS "Platform admins can view all named contacts"/i,
    );
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "Service role can (read|write) named contacts"/i);
    expect(ALL_SQL).toMatch(/"Platform admins can view all named contacts"/);
    expect(ALL_SQL).toMatch(/"Service role can read named contacts"/);
    expect(ALL_SQL).toMatch(/"Service role can write named contacts"/);
  });

  it("does not modify INSERT/UPDATE/DELETE policies for match_named_contacts", () => {
    expect(sql).not.toMatch(
      /CREATE POLICY .* ON public\.match_named_contacts\s+FOR (INSERT|UPDATE|DELETE)/i,
    );
  });
});

describe("Privacy Batch 1 — out-of-scope guarantees", () => {
  const sql = PRIVACY_BATCH_1_FILE!.sql;

  it("does not touch profiles RLS", () => {
    expect(sql).not.toMatch(/profiles/i);
  });

  it("does not touch poi_engagements or Realtime publication", () => {
    expect(sql).not.toMatch(/poi_engagements/i);
    expect(sql).not.toMatch(/supabase_realtime/i);
    expect(sql).not.toMatch(/ALTER PUBLICATION/i);
  });

  it("does not drop or alter columns", () => {
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?DROP COLUMN/i);
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?ALTER COLUMN/i);
  });
});
