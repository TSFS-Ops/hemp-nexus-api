/**
 * Batch P — Role, Membership and Authority hardening (static source-contract tests).
 *
 * Verifies the migration + AuthContext changes for:
 *   - prevent_last_admin_removal_trg
 *   - log_membership_change_trg (membership.changed audit)
 *   - transfer_org_admin RPC (atomic handover)
 *   - change_org_member_role hardening (reason, AAL2, before/after audit, notify)
 *   - frozen-role allowlist remains intact
 *   - client cache invalidation on role / org change
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = "supabase/migrations";

function migrationsContaining(snippet: string): string[] {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(MIG_DIR, f), "utf8"))
    .filter((body) => body.includes(snippet));
}

function latestMigrationWith(snippet: string): string {
  const matches = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .map((f) => ({ f, body: readFileSync(resolve(MIG_DIR, f), "utf8") }))
    .filter(({ body }) => body.includes(snippet));
  if (!matches.length) throw new Error(`No migration contains: ${snippet}`);
  return matches[0].body;
}

describe("Batch P — DB invariants", () => {
  it("creates prevent_last_admin_removal_trg on user_roles BEFORE DELETE OR UPDATE", () => {
    const sql = latestMigrationWith("prevent_last_admin_removal_trg");
    expect(sql).toMatch(/CREATE TRIGGER prevent_last_admin_removal_trg/);
    expect(sql).toMatch(/BEFORE DELETE OR UPDATE ON public\.user_roles/);
    expect(sql).toMatch(/LAST_ADMIN/);
  });

  it("trigger honours app.allow_admin_transfer bypass (used by transfer_org_admin only)", () => {
    const sql = latestMigrationWith("prevent_last_admin_removal");
    expect(sql).toMatch(/app\.allow_admin_transfer/);
  });

  it("creates log_membership_change_trg AFTER UPDATE OF org_id on profiles", () => {
    const sql = latestMigrationWith("log_membership_change_trg");
    expect(sql).toMatch(/CREATE TRIGGER log_membership_change_trg/);
    expect(sql).toMatch(/AFTER UPDATE OF org_id ON public\.profiles/);
    expect(sql).toMatch(/'membership\.changed'/);
    expect(sql).toMatch(/old_org_id/);
    expect(sql).toMatch(/new_org_id/);
  });

  it("membership audit captures actor via auth.uid or app.actor_user_id GUC", () => {
    const sql = latestMigrationWith("log_membership_change");
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(sql).toMatch(/app\.actor_user_id/);
  });

  it("transfer_org_admin RPC requires reason and is atomic", () => {
    const sql = latestMigrationWith("FUNCTION public.transfer_org_admin");
    expect(sql).toMatch(/p_reason text/);
    expect(sql).toMatch(/REASON_REQUIRED/);
    expect(sql).toMatch(/role\.admin_transferred/);
    // promotes target before any self-demote
    const promoteIdx = sql.search(/INSERT INTO user_roles[\s\S]*?'org_admin'/);
    const demoteIdx = sql.search(/DELETE FROM user_roles[\s\S]*?'org_admin'/);
    expect(promoteIdx).toBeGreaterThan(-1);
    if (demoteIdx > -1) expect(promoteIdx).toBeLessThan(demoteIdx);
  });

  it("transfer_org_admin re-asserts at least one admin remains post-demotion", () => {
    const sql = latestMigrationWith("FUNCTION public.transfer_org_admin");
    expect(sql).toMatch(/TRANSFER_FAILED_NO_ADMIN/);
  });

  it("transfer_org_admin EXECUTE is restricted to authenticated", () => {
    const sql = latestMigrationWith("FUNCTION public.transfer_org_admin");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.transfer_org_admin/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.transfer_org_admin/);
  });
});

describe("Batch P — change_org_member_role hardening", () => {
  const sql = latestMigrationWith("FUNCTION public.change_org_member_role");

  it("keeps the org_member / org_admin allowlist", () => {
    expect(sql).toMatch(/v_allowed_roles\s+text\[\]\s*:=\s*ARRAY\[\s*'org_member'\s*,\s*'org_admin'\s*\]/);
  });

  it("requires a reason when demoting an org_admin", () => {
    expect(sql).toMatch(/v_is_demotion/);
    expect(sql).toMatch(/REASON_REQUIRED/);
  });

  it("requires AAL2 for demotion when called from an end-user JWT", () => {
    expect(sql).toMatch(/MFA_REQUIRED/);
    expect(sql).toMatch(/request\.jwt\.claims/);
    expect(sql).toMatch(/aal2/);
  });

  it("audits before/after role state with actor_org_id and target_org_id", () => {
    expect(sql).toMatch(/'role\.changed'/);
    expect(sql).toMatch(/old_roles/);
    expect(sql).toMatch(/new_roles/);
    expect(sql).toMatch(/actor_org_id/);
    expect(sql).toMatch(/target_org_id/);
  });

  it("notifies the affected user in-app", () => {
    expect(sql).toMatch(/INSERT INTO notifications/);
    expect(sql).toMatch(/role\.changed/);
  });

  it("keeps SELF_CHANGE and NOT_IN_ORG guards", () => {
    expect(sql).toMatch(/SELF_CHANGE/);
    expect(sql).toMatch(/NOT_IN_ORG/);
  });
});

describe("Batch P — frozen / legacy roles remain blocked", () => {
  it("legacy 'admin' role is still rejected by prevent_frozen_role_assignment", () => {
    // Trigger lives in earlier migration; just confirm allowlist did not regress.
    const sql = latestMigrationWith("FUNCTION public.change_org_member_role");
    expect(sql).not.toMatch(/'admin'\s*,/); // no legacy admin sneaking into allowlist
    expect(sql).not.toMatch(/'platform_admin'\s*,/); // no elevation via this RPC
  });

  it("frozen role guard trigger still exists in migration history", () => {
    expect(migrationsContaining("prevent_frozen_role_assignment").length).toBeGreaterThan(0);
  });
});

describe("Batch P — AuthContext stale-UI invalidation", () => {
  const ctx = readFileSync(resolve("src/contexts/AuthContext.tsx"), "utf8");

  it("imports the React Query client for cache invalidation", () => {
    expect(ctx).toMatch(/from\s+["']@\/lib\/query-client["']/);
  });

  it("invalidates queries when roles change mid-session", () => {
    expect(ctx).toMatch(/invalidateRoleScopedCaches/);
    expect(ctx).toMatch(/queryClient\.invalidateQueries/);
  });

  it("watches profiles.org_id mid-session and reacts to membership change", () => {
    expect(ctx).toMatch(/previousOrgIdRef/);
    expect(ctx).toMatch(/removed from your organisation/i);
    expect(ctx).toMatch(/membership changed/i);
  });

  it("signs the user out when their org_id becomes null", () => {
    expect(ctx).toMatch(/currentOrgId === null[\s\S]*?signOut/);
  });
});

describe("Batch P — platform-admin target_org_id audit clarity", () => {
  it("role.changed audit distinguishes actor_org_id from target_org_id", () => {
    const sql = latestMigrationWith("FUNCTION public.change_org_member_role");
    expect(sql).toMatch(/'actor_org_id'/);
    expect(sql).toMatch(/'target_org_id'/);
  });
});
