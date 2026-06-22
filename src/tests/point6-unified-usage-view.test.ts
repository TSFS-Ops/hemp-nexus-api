/**
 * Point 6 — Admin/Client Usage Visibility
 * Static guard for the unified read-only view + row RPCs migration.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

function findMigration(token: string): string {
  const file = readdirSync(MIG_DIR).find((f) =>
    readFileSync(join(MIG_DIR, f), "utf8").includes(token),
  );
  if (!file) throw new Error(`migration containing "${token}" not found`);
  return readFileSync(join(MIG_DIR, file), "utf8");
}

describe("Point 6 · unified usage view migration", () => {
  const sql = findMigration("v_api_usage_unified");

  it("creates the v_api_usage_unified view", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_api_usage_unified/);
  });

  it("grants SELECT to authenticated and service_role (not anon)", () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.v_api_usage_unified TO authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON public\.v_api_usage_unified TO service_role/);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.v_api_usage_unified TO anon/);
  });

  it("exposes only the columns David's questionnaire requires", () => {
    for (const col of [
      "api_client_id", "api_client_name", "api_key_id", "api_key_alias",
      "endpoint", "method", "environment", "request_id", "created_at",
      "status_code", "chargeable", "non_billable_reason", "error_code",
      "credits_burned", "closing_balance", "opening_balance",
    ]) {
      expect(sql, `view should expose ${col}`).toMatch(new RegExp(col));
    }
  });

  it("does NOT expose raw bodies, key hashes, IPs, user-agents, or secrets", () => {
    const viewBlock = sql.match(/CREATE OR REPLACE VIEW public\.v_api_usage_unified[\s\S]*?;\s/);
    expect(viewBlock).toBeTruthy();
    const block = viewBlock![0].toLowerCase();
    for (const forbidden of ["key_hash", "secret", "request_body", "response_body", "ip_address", "user_agent", "password"]) {
      expect(block, `view must not select ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("opening_balance is derived (not stored on api_request_logs)", () => {
    // It only appears inside the view definition, never as ALTER TABLE.
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?opening_balance/);
    expect(sql).toMatch(/AS\s+opening_balance/);
  });

  it("view is SECURITY INVOKER", () => {
    // Either set inline or via the follow-up ALTER VIEW migration.
    const followUp = findMigration("security_invoker = true");
    expect(followUp).toMatch(/v_api_usage_unified/);
  });

  it("creates the customer row RPC scoped by can_view_api_client_usage", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_api_client_usage_rows/);
    expect(sql).toMatch(/can_view_api_client_usage\(auth\.uid\(\), p_api_client_id\)/);
  });

  it("creates the admin row RPC role-gated to platform_admin/api_admin/auditor", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_api_admin_usage_rows/);
    expect(sql).toMatch(/'platform_admin'/);
    expect(sql).toMatch(/'api_admin'/);
    expect(sql).toMatch(/'auditor'/);
  });

  it("RPCs revoke anon and grant only authenticated + service_role", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_api_client_usage_rows[\s\S]*?FROM PUBLIC, anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_api_admin_usage_rows[\s\S]*?FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_api_client_usage_rows[\s\S]*?TO authenticated, service_role/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_api_admin_usage_rows[\s\S]*?TO authenticated, service_role/);
  });

  it("RPCs SET search_path = public", () => {
    expect(sql).toMatch(/SET search_path = public/);
  });
});
