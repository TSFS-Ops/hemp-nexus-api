/**
 * P-5 Batch 3 — Stage 3 RPC contract test.
 *
 * Asserts the RPC wrappers exist, target the canonical SECURITY DEFINER
 * function names, and the migration declares each one with SECURITY DEFINER
 * and SET search_path = public.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { P5B3_RPC_NAMES } from "@/lib/p5-batch3/rpc";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

function loadAllMigrationsText(): string {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
    .join("\n");
}

describe("P5 Batch 3 Stage 3 — RPC contracts", () => {
  const sql = loadAllMigrationsText();

  it("declares every Stage 3 RPC in a migration", () => {
    for (const name of P5B3_RPC_NAMES) {
      expect(sql).toMatch(new RegExp(`FUNCTION\\s+public\\.${name}\\b`));
    }
  });

  it("every Stage 3 RPC is SECURITY DEFINER with explicit search_path", () => {
    for (const name of P5B3_RPC_NAMES) {
      const re = new RegExp(
        `FUNCTION\\s+public\\.${name}[\\s\\S]*?SECURITY\\s+DEFINER[\\s\\S]*?SET\\s+search_path\\s*=\\s*public`,
      );
      expect(sql).toMatch(re);
    }
  });

  it("admin-only RPCs assert p5b3_is_platform_admin()", () => {
    const adminRpcs = P5B3_RPC_NAMES.filter((n) => n.startsWith("p5b3_admin_"));
    for (const name of adminRpcs) {
      const slice = sql.split(new RegExp(`FUNCTION\\s+public\\.${name}\\b`))[1] ?? "";
      const body = slice.split(/\$\$;/)[0] ?? "";
      expect(body, name).toMatch(/p5b3_is_platform_admin\(\)/);
    }
  });

  it("access-grant RPC rejects missing expiry / release reason / pack version", () => {
    const slice = sql.split(/FUNCTION\s+public\.p5b3_admin_create_access_grant_v1\b/)[1] ?? "";
    const body = slice.split(/\$\$;/)[0] ?? "";
    expect(body).toMatch(/expiry_at\s+IS\s+NULL[\s\S]*RAISE\s+EXCEPTION/);
    expect(body).toMatch(/release_reason required/);
    expect(body).toMatch(/evidence_pack_id\s*\+\s*version\s*required/);
  });

  it("admin request-edit RPC preserves original message", () => {
    const slice = sql.split(/FUNCTION\s+public\.p5b3_admin_edit_request_external_text_v1\b/)[1] ?? "";
    const body = slice.split(/\$\$;/)[0] ?? "";
    expect(body).not.toMatch(/SET\s+original_message/);
    expect(body).toMatch(/admin_external_message/);
    expect(body).toMatch(/original_message_preserved/);
  });

  it("funder outcome RPC explicitly records finality_created=false", () => {
    const slice = sql.split(/FUNCTION\s+public\.p5b3_funder_submit_outcome_v1\b/)[1] ?? "";
    const body = slice.split(/\$\$;/)[0] ?? "";
    expect(body).toMatch(/finality_created.*false/);
  });

  it("download RPC enforces PDF + 7-day TTL ceiling", () => {
    const slice = sql.split(/FUNCTION\s+public\.p5b3_funder_record_download_v1\b/)[1] ?? "";
    const body = slice.split(/\$\$;/)[0] ?? "";
    expect(body).toMatch(/7\*24\*60\*60/);
    expect(body).toMatch(/only released PDF packs/);
  });

  it("EXECUTE on every Stage 3 RPC is revoked from PUBLIC and anon", () => {
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.%I\(%s\)\s+FROM\s+PUBLIC/);
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.%I\(%s\)\s+FROM\s+anon/);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.%I\(%s\)\s+TO\s+authenticated,\s*service_role/);
  });
});
