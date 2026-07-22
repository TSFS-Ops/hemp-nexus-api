/**
 * Institutional Funder Evidence Workspace — Batch 1 foundation guard.
 *
 * DB-only, additive foundation. This test asserts the migration text
 * contains the required schema, helpers, RPCs and policies, and that no
 * forbidden changes were made (no enum renames, no destructive drops,
 * no PDF/notification/billing/UI wiring).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadBatch1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const found = bodies.find(
    (b) =>
      /CREATE TABLE IF NOT EXISTS public\.funder_org_onboarding_requests/.test(b) &&
      /CREATE TABLE IF NOT EXISTS public\.funder_deal_releases/.test(b) &&
      /CREATE TABLE IF NOT EXISTS public\.funder_release_consents/.test(b) &&
      /CREATE TABLE IF NOT EXISTS public\.funder_pack_versions/.test(b) &&
      /CREATE TABLE IF NOT EXISTS public\.funder_usage_events/.test(b),
  );
  if (!found) throw new Error("Funder Workspace Batch 1 migration not found");
  return found;
}

const SQL = loadBatch1Sql();

describe("Funder Workspace Batch 1 — schema", () => {
  it("creates all five new canonical tables", () => {
    for (const t of [
      "funder_org_onboarding_requests",
      "funder_deal_releases",
      "funder_release_consents",
      "funder_pack_versions",
      "funder_usage_events",
    ]) {
      expect(SQL).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
      expect(SQL).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(SQL).toMatch(new RegExp(`GRANT ALL ON public\\.${t} TO service_role`));
    }
  });

  it("extends p5_batch3_funder_organisations with nullable approval-workflow columns", () => {
    for (const col of [
      "approval_status",
      "requested_at",
      "approved_by",
      "approved_at",
      "rejected_by",
      "rejected_at",
      "rejection_reason",
      "suspended_at",
      "suspended_by",
      "suspension_reason",
      "contact_person_name",
      "contact_phone",
    ]) {
      expect(SQL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
    // Nullable additions only — no NOT NULL, no default backfill statements.
    expect(SQL).not.toMatch(/ADD COLUMN IF NOT EXISTS approval_status[^,;]*NOT NULL/);
  });

  it("declares the required deal-release permission and consent columns", () => {
    const releaseBlock = SQL.split("CREATE TABLE IF NOT EXISTS public.funder_deal_releases")[1] ?? "";
    for (const col of [
      "can_view_evidence_summary",
      "can_view_evidence_room",
      "can_download_compiled_pack",
      "can_view_raw_documents",
      "can_download_raw_documents",
      "can_view_unmasked_sensitive_details",
      "buyer_consent_status",
      "seller_consent_status",
      "admin_override_reason",
    ]) {
      expect(releaseBlock).toContain(col);
    }
    // Raw-document permissions must default to false.
    expect(releaseBlock).toMatch(/can_view_raw_documents boolean NOT NULL DEFAULT false/);
    expect(releaseBlock).toMatch(/can_download_raw_documents boolean NOT NULL DEFAULT false/);
    expect(releaseBlock).toMatch(/can_download_compiled_pack boolean NOT NULL DEFAULT false/);
    expect(releaseBlock).toMatch(/can_view_unmasked_sensitive_details boolean NOT NULL DEFAULT false/);
  });

  it("enforces sealed-pack immutability via trigger", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_pack_versions_seal_guard/);
    expect(SQL).toMatch(/fw\.pack_sealed_immutable/);
    expect(SQL).toMatch(/CREATE TRIGGER fw_pack_versions_seal_guard_trg/);
  });

  it("does not include any billing/payment/pricing columns", () => {
    const usageBlock = SQL.split("CREATE TABLE IF NOT EXISTS public.funder_usage_events")[1] ?? "";
    for (const forbidden of ["price", "amount_", "invoice", "payment_status", "currency"]) {
      expect(usageBlock.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("Funder Workspace Batch 1 — helpers & role mapping", () => {
  it("declares all required helper functions", () => {
    for (const fn of [
      "funder_role_for_v1",
      "fw_current_funder_org_v1",
      "fw_is_funder_org_approved_v1",
      "fw_has_deal_release_v1",
      "fw_can_view_raw_documents_v1",
      "fw_can_download_compiled_pack_v1",
      "fw_audit",
      "fw_record_usage",
    ]) {
      expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
    }
  });

  it("maps every existing p5_batch3_funder_role value to V1 labels without renaming the enum", () => {
    const mapBlock = SQL.split("funder_role_for_v1")[1] ?? "";
    expect(mapBlock).toMatch(/WHEN 'funder_org_admin' THEN 'admin'/);
    expect(mapBlock).toMatch(/WHEN 'funder_approver' {2}THEN 'approver'/);
    expect(mapBlock).toMatch(/WHEN 'funder_reviewer' {2}THEN 'reviewer'/);
    expect(mapBlock).toMatch(/WHEN 'funder_viewer' {4}THEN 'viewer'/);
    expect(mapBlock).toMatch(/WHEN 'external_adviser' THEN 'external_adviser'/);
    // Enum must not be recreated or altered.
    expect(SQL).not.toMatch(/CREATE TYPE public\.p5_batch3_funder_role/);
    expect(SQL).not.toMatch(/ALTER TYPE public\.p5_batch3_funder_role/);
    expect(SQL).not.toMatch(/DROP TYPE public\.p5_batch3_funder_role/);
  });
});

describe("Funder Workspace Batch 1 — RPCs and validation", () => {
  it("declares all required RPCs", () => {
    for (const rpc of [
      "fw_request_funder_onboarding_v1",
      "fw_admin_approve_funder_org_v1",
      "fw_admin_reject_funder_org_v1",
      "fw_admin_release_deal_v1",
      "fw_admin_revoke_deal_release_v1",
    ]) {
      expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`));
    }
  });

  it("onboarding request validates required fields and V1 funder types", () => {
    const b = SQL.split("fw_request_funder_onboarding_v1")[1] ?? "";
    expect(b).toMatch(/organisation_name required/);
    expect(b).toMatch(/primary_contact_email required/);
    expect(b).toMatch(/funder_type not allowed in V1/);
    expect(b).toMatch(/commercial_bank/);
    expect(b).toMatch(/dfi/);
    expect(b).toMatch(/mdb/);
    expect(b).toMatch(/treasury_entity/);
    expect(b).toMatch(/eca/);
    expect(b).toMatch(/private_debt_fund/);
    // V1 out-of-scope funder types must not be accepted.
    for (const forbidden of ["insurer", "broker", "adviser", "equity_investor", "marketplace"]) {
      expect(b.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("admin reject requires non-empty reason", () => {
    const b = SQL.split("fw_admin_reject_funder_org_v1")[1] ?? "";
    expect(b).toMatch(/p5b3_is_platform_admin/);
    expect(b).toMatch(/rejection reason required/);
  });

  it("admin release enforces consent gate with override reason fallback", () => {
    const b = SQL.split("fw_admin_release_deal_v1")[1] ?? "";
    expect(b).toMatch(/p5b3_is_platform_admin/);
    expect(b).toMatch(/fw_is_funder_org_approved_v1/);
    expect(b).toMatch(/release_reason required/);
    expect(b).toMatch(/expires_at must be in the future/);
    expect(b).toMatch(
      /fw\.consent_required: buyer\/seller consent missing and no admin_override_reason/,
    );
    // Consent granted/not_required path must not raise consent_required.
    expect(b).toMatch(/v_buyer IN \('granted','not_required'\)/);
    expect(b).toMatch(/v_seller IN \('granted','not_required'\)/);
    // Override must be trimmed and rejected when empty.
    expect(b).toMatch(/v_override := trim\(coalesce\(p_admin_override_reason,''\)\);/);
  });

  it("admin release RPC does not attempt PDF generation or signed URL issuance", () => {
    const b = SQL.split("fw_admin_release_deal_v1")[1] ?? "";
    expect(b.toLowerCase()).not.toContain("pdf");
    expect(b.toLowerCase()).not.toContain("signed_url");
    expect(b.toLowerCase()).not.toContain("storage.");
  });

  it("revoke RPC requires reason and is admin-gated", () => {
    const b = SQL.split("fw_admin_revoke_deal_release_v1")[1] ?? "";
    expect(b).toMatch(/p5b3_is_platform_admin/);
    expect(b).toMatch(/revocation reason required/);
  });

  it("all new RPCs write to the existing p5_batch3_funder_audit_events table via fw_audit", () => {
    for (const rpc of [
      "fw_request_funder_onboarding_v1",
      "fw_admin_approve_funder_org_v1",
      "fw_admin_reject_funder_org_v1",
      "fw_admin_release_deal_v1",
      "fw_admin_revoke_deal_release_v1",
    ]) {
      const b = SQL.split(rpc)[1] ?? "";
      expect(b).toMatch(/PERFORM public\.fw_audit\(/);
      expect(b).toMatch(/PERFORM public\.fw_record_usage\(/);
    }
    expect(SQL).toMatch(
      /INSERT INTO public\.p5_batch3_funder_audit_events/,
    );
  });
});

describe("Funder Workspace Batch 1 — RLS and cross-funder isolation", () => {
  it("scopes funder read policies through p5b3_current_funder_org()", () => {
    for (const pol of [
      "fw_release_funder_select",
      "fw_consent_funder_select",
      "fw_pack_funder_select",
      "fw_usage_funder_select",
    ]) {
      expect(SQL).toMatch(new RegExp(`CREATE POLICY "${pol}"`));
    }
    // Each funder-select policy must reference the current-funder-org helper.
    const funderSelects = SQL.match(/CREATE POLICY "fw_[a-z_]+funder_select"[\s\S]*?;/g) ?? [];
    expect(funderSelects.length).toBeGreaterThanOrEqual(4);
    for (const p of funderSelects) {
      expect(p).toMatch(/p5b3_current_funder_org\(\)/);
    }
  });

  it("funder-facing tables grant only SELECT to authenticated (no INSERT/UPDATE/DELETE for funders)", () => {
    for (const t of ["funder_deal_releases", "funder_release_consents", "funder_pack_versions", "funder_usage_events"]) {
      const grantLine = new RegExp(`GRANT ([A-Z, ]+) ON public\\.${t} TO authenticated`);
      const m = SQL.match(grantLine);
      expect(m, `expected grant for ${t}`).toBeTruthy();
      expect(m![1]).toBe("SELECT");
    }
  });

  it("admin ALL policies use the existing platform-admin helper", () => {
    const adminAllPolicies = SQL.match(/CREATE POLICY "fw_[a-z_]+admin_all"[\s\S]*?;/g) ?? [];
    expect(adminAllPolicies.length).toBeGreaterThanOrEqual(5);
    for (const p of adminAllPolicies) {
      expect(p).toMatch(/p5b3_is_platform_admin\(\)/);
    }
  });
});

describe("Funder Workspace Batch 1 — non-destructive guarantees", () => {
  it("does not drop or rename any existing Batch-3 or Batch-4 object", () => {
    for (const forbidden of [
      /DROP TABLE public\.p5_batch3_/,
      /DROP TABLE public\.p5_batch4_/,
      /ALTER TABLE public\.p5_batch3_funder_access_grants/,
      /DROP FUNCTION public\.p5b3_/,
      /DROP FUNCTION public\.p5b4_/,
      /ALTER FUNCTION public\.p5b3_funder_record_download_v1/,
      /DROP POLICY [^;]*p5b3_/,
      /DROP POLICY [^;]*p5b4_/,
    ]) {
      expect(SQL).not.toMatch(forbidden);
    }
  });

  it("does not touch consents, notifications, billing, or payment surfaces", () => {
    for (const forbidden of [
      /CREATE TABLE [^;]*\bconsents\b/,
      /ALTER TABLE public\.consents/,
      /CREATE TABLE [^;]*notification_/,
      /CREATE TABLE [^;]*billing_/,
      /CREATE TABLE [^;]*invoice/,
      /CREATE TABLE [^;]*payment/,
      /CREATE TABLE [^;]*token_/,
    ]) {
      expect(SQL).not.toMatch(forbidden);
    }
  });

  it("locks down EXECUTE on all new fw_* functions", () => {
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.%I\(%s\) TO authenticated, service_role/);
  });
});
