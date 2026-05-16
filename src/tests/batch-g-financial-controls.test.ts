/**
 * Batch G — Financial-control hardening and admin-settings audit.
 *
 * Static / source-level verification (mirrors the pattern used by other
 * batch tests in this repo). Covers the 14 acceptance items in the
 * Batch G brief:
 *
 *   1.  billing disabled backend guard fires BEFORE Paystack call
 *   2.  billing disabled guard runs before idempotency/audit/ledger side-effects
 *   3.  billing_availability change writes admin_settings.changed
 *   4.  test_mode_bypass change writes admin_settings.changed
 *   5.  maintenance change still writes maintenance audit + generic audit
 *   6.  sensitive admin_settings update requires AAL2 (BEFORE trigger)
 *   7.  non-AAL2 path raises AAL2_REQUIRED
 *   8.  service-role / backend writes bypass the AAL2 trigger
 *   9.  admin-credit-org requires reason (Zod.min(1)) and supports reference_id
 *   10. admin-credit-org stamps credit_kind='admin_manual' (or _demo)
 *   11. admin-credit-org mirrors reference_id into payment_reference metadata
 *   12. demo-org top-up stamps demo=true / credit_kind='admin_manual_demo'
 *   13. RecentSensitiveSettingsTile queries admin_audit_logs for the 3 actions
 *   14. get_billing_availability hook never reads admin-only fields
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

const TOKEN_PURCHASE = read("supabase/functions/token-purchase/index.ts");
const ADMIN_CREDIT = read("supabase/functions/admin-credit-org/index.ts");
const TILE = read("src/components/governance/RecentSensitiveSettingsTile.tsx");
const HEALTHBOARD = read("src/components/governance/HealthBoard.tsx");
const HOOK = read("src/hooks/use-billing-availability.ts");

// We grep the most recent Batch G migration by its trigger names.
const MIGRATIONS_DIR = "supabase/migrations";
import { readdirSync } from "node:fs";
const MIGRATION_FILES = readdirSync(resolve(MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(`${MIGRATIONS_DIR}/${f}`))
  .join("\n\n");

describe("Batch G — billing-disabled backend guard ordering", () => {
  it("1. billing-availability guard runs before any Paystack call", () => {
    const guardIdx = TOKEN_PURCHASE.indexOf('supabase.rpc("get_billing_availability")');
    const paystackIdx = TOKEN_PURCHASE.indexOf("paystack");
    expect(guardIdx).toBeGreaterThan(0);
    expect(paystackIdx).toBeGreaterThan(guardIdx);
  });

  it("2. billing-availability guard runs before idempotency/audit/ledger writes", () => {
    const guardIdx = TOKEN_PURCHASE.indexOf('supabase.rpc("get_billing_availability")');
    const idemIdx = TOKEN_PURCHASE.indexOf("idempotency_keys");
    const ledgerIdx = TOKEN_PURCHASE.indexOf("atomic_token_credit");
    const auditIdx = TOKEN_PURCHASE.indexOf('"credits.purchase_initiated"');
    expect(guardIdx).toBeGreaterThan(0);
    expect(idemIdx).toBeGreaterThan(guardIdx);
    expect(ledgerIdx).toBeGreaterThan(guardIdx);
    expect(auditIdx).toBeGreaterThan(guardIdx);
  });

  it("returns BILLING_UNAVAILABLE / 503 when flag is false", () => {
    expect(TOKEN_PURCHASE).toMatch(/BILLING_UNAVAILABLE/);
    expect(TOKEN_PURCHASE).toMatch(/status:\s*503/);
  });
});

describe("Batch G — admin_settings.changed audit trigger", () => {
  it("3. trigger writes admin_settings.changed for any value change", () => {
    expect(MIGRATION_FILES).toMatch(/log_admin_settings_change/);
    expect(MIGRATION_FILES).toMatch(/trg_log_admin_settings_change/);
    expect(MIGRATION_FILES).toMatch(/'admin_settings\.changed'/);
  });

  it("4. trigger flags test_mode_bypass + billing_availability as sensitive", () => {
    expect(MIGRATION_FILES).toMatch(/'billing_availability'/);
    expect(MIGRATION_FILES).toMatch(/'test_mode_bypass'/);
    expect(MIGRATION_FILES).toMatch(/'general'/);
    expect(MIGRATION_FILES).toMatch(/v_sensitive/);
  });

  it("5. existing maintenance-specific trigger is preserved", () => {
    expect(MIGRATION_FILES).toMatch(/log_maintenance_mode_change/);
    expect(MIGRATION_FILES).toMatch(/maintenance_mode\.enabled/);
    expect(MIGRATION_FILES).toMatch(/maintenance_mode\.disabled/);
  });

  it("records previous_value, new_value, actor_user_id, changed_at", () => {
    expect(MIGRATION_FILES).toMatch(/'previous_value'/);
    expect(MIGRATION_FILES).toMatch(/'new_value'/);
    expect(MIGRATION_FILES).toMatch(/'actor_user_id'/);
    expect(MIGRATION_FILES).toMatch(/'changed_at'/);
  });
});

describe("Batch G — AAL2 enforcement for sensitive admin_settings", () => {
  it("6. BEFORE UPDATE trigger enforces AAL2 on sensitive keys", () => {
    expect(MIGRATION_FILES).toMatch(/enforce_admin_settings_aal2/);
    expect(MIGRATION_FILES).toMatch(/trg_enforce_admin_settings_aal2/);
    expect(MIGRATION_FILES).toMatch(/BEFORE UPDATE ON public\.admin_settings/);
  });

  it("7. non-aal2 caller raises AAL2_REQUIRED with 42501", () => {
    expect(MIGRATION_FILES).toMatch(/AAL2_REQUIRED/);
    expect(MIGRATION_FILES).toMatch(/'42501'/);
  });

  it("8. service_role / postgres / null-claims paths are exempt", () => {
    expect(MIGRATION_FILES).toMatch(/'service_role'/);
    expect(MIGRATION_FILES).toMatch(/'postgres'/);
    expect(MIGRATION_FILES).toMatch(/v_claims IS NULL/);
  });

  it("UI surfaces AAL2_REQUIRED in plain English in AdminSettings + TestModeBypassPanel", () => {
    const adminSettings = read("src/components/admin/AdminSettings.tsx");
    const testModePanel = read("src/components/admin/TestModeBypassPanel.tsx");
    expect(adminSettings).toMatch(/AAL2_REQUIRED/);
    expect(adminSettings).toMatch(/MFA required/);
    expect(testModePanel).toMatch(/AAL2_REQUIRED/);
    expect(testModePanel).toMatch(/MFA required/);
  });
});

describe("Batch G — manual credit ledger metadata", () => {
  it("9. admin-credit-org requires reason via Zod (min(1)) and supports reference_id", () => {
    expect(ADMIN_CREDIT).toMatch(/reason:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(ADMIN_CREDIT).toMatch(/reference_id:\s*z\.string\(\)/);
  });

  it("10. stamps credit_kind = admin_manual (or admin_manual_demo)", () => {
    expect(ADMIN_CREDIT).toMatch(/admin_manual_demo/);
    expect(ADMIN_CREDIT).toMatch(/admin_manual/);
    expect(ADMIN_CREDIT).toMatch(/credit_kind:/);
  });

  it("11. mirrors reference_id into payment_reference + reference_id metadata", () => {
    expect(ADMIN_CREDIT).toMatch(/payment_reference:\s*referenceId/);
    expect(ADMIN_CREDIT).toMatch(/reference_id:\s*referenceId/);
  });

  it("12. demo-org branch stamps demo=true and admin_manual_demo", () => {
    expect(ADMIN_CREDIT).toMatch(/is_demo/);
    expect(ADMIN_CREDIT).toMatch(/demo:\s*isDemo/);
    expect(ADMIN_CREDIT).toMatch(/isDemo \? 'admin_manual_demo' : 'admin_manual'/);
  });

  it("calls atomic_token_credit with p_extra_metadata payload", () => {
    expect(ADMIN_CREDIT).toMatch(/p_extra_metadata:\s*extraMetadata/);
    expect(MIGRATION_FILES).toMatch(/p_extra_metadata jsonb DEFAULT/);
  });

  it("preserves admin.credit_org admin_audit_logs action", () => {
    expect(ADMIN_CREDIT).toMatch(/'admin\.credit_org'/);
  });

  it("preserves SECDEF Stage D1 service_role-only EXECUTE on the new overload", () => {
    expect(MIGRATION_FILES).toMatch(
      /REVOKE ALL ON FUNCTION public\.atomic_token_credit\(uuid, integer, text, text, jsonb\) FROM PUBLIC/,
    );
    expect(MIGRATION_FILES).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.atomic_token_credit\(uuid, integer, text, text, jsonb\) TO service_role/,
    );
  });
});

describe("Batch G — HealthBoard sensitive-settings tile", () => {
  it("13. tile queries admin_audit_logs for the three audited actions", () => {
    expect(TILE).toMatch(/admin_audit_logs/);
    expect(TILE).toMatch(/admin_settings\.changed/);
    expect(TILE).toMatch(/maintenance_mode\.enabled/);
    expect(TILE).toMatch(/maintenance_mode\.disabled/);
  });

  it("tile is read-only (no insert/update/delete/rpc mutations)", () => {
    expect(TILE).not.toMatch(/\.insert\(/);
    expect(TILE).not.toMatch(/\.update\(/);
    expect(TILE).not.toMatch(/\.delete\(/);
    expect(TILE).not.toMatch(/\.upsert\(/);
  });

  it("tile is mounted inside HealthBoard", () => {
    expect(HEALTHBOARD).toMatch(/RecentSensitiveSettingsTile/);
  });
});

describe("Batch G — public billing-availability surface", () => {
  it("14. hook only reads enabled / reason / message — no admin-only fields", () => {
    expect(HOOK).toMatch(/blob\.enabled/);
    expect(HOOK).toMatch(/blob\.reason/);
    expect(HOOK).toMatch(/blob\.message/);
    // Defensive: the hook must NOT read any obviously-admin-only key.
    expect(HOOK).not.toMatch(/updated_by/);
    expect(HOOK).not.toMatch(/internal_/);
    expect(HOOK).not.toMatch(/locked_reason/);
  });

  it("hook fails closed (default disabled) on RPC error", () => {
    expect(HOOK).toMatch(/DEFAULT_DISABLED/);
    expect(HOOK).toMatch(/enabled:\s*false/);
  });
});
