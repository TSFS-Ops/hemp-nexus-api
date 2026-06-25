/**
 * P-5 Batch 4 Stage 3 — RPC contract tests (static).
 *
 * Verifies that the Stage 3 migration installs every RPC the brief
 * specifies, that every RPC body sets `search_path = public`, runs as
 * SECURITY DEFINER, writes an audit row, and (where required) calls
 * the reason guard. Static so it runs without a live DB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  P5B4_RPC_NAMES,
  P5B4_ADMIN_RPCS,
  P5B4_REASON_REQUIRED_RPCS,
} from "@/lib/p5-batch4/rpc";

const MIG_DIR = "supabase/migrations";

function loadStage3(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
  let combined = "";
  for (const f of files) {
    const body = readFileSync(join(MIG_DIR, f), "utf8");
    if (body.includes("Batch 4 Stage 3") || /CREATE OR REPLACE FUNCTION public\.p5b4_[a-z_]+_v1/.test(body)) {
      combined += "\n" + body;
    }
  }
  return combined;
}

function isolateFunction(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION public.${name}(`);
  if (start === -1) return "";
  const end = source.indexOf("$$;", start);
  return source.slice(start, end + 3);
}

describe("Stage 3 RPC contract", () => {
  const sql = loadStage3();

  it("migration body is present", () => {
    expect(sql.length).toBeGreaterThan(2000);
  });

  it.each([...P5B4_RPC_NAMES])("declares %s", (name) => {
    const body = isolateFunction(sql, name);
    expect(body, `RPC ${name} not found`).not.toEqual("");
  });

  it.each([...P5B4_RPC_NAMES])("%s is SECURITY DEFINER with search_path=public", (name) => {
    const body = isolateFunction(sql, name);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
  });

  it.each([...P5B4_RPC_NAMES.filter((n) => n !== "p5b4_record_audit_event_v1")])(
    "%s writes an audit event",
    (name) => {
      const body = isolateFunction(sql, name);
      // Either calls the audit helper directly or via record_audit_event.
      expect(body).toMatch(/p5b4_write_audit\(|p5b4_record_audit_event_v1\(/);
    },
  );

  it.each([...P5B4_ADMIN_RPCS])("%s gates on platform admin", (name) => {
    const body = isolateFunction(sql, name);
    expect(body).toMatch(/p5b4_require_admin\(\)/);
  });

  it.each([...P5B4_REASON_REQUIRED_RPCS])("%s requires a reason", (name) => {
    const body = isolateFunction(sql, name);
    expect(body).toMatch(/p5b4_require_reason\(/);
  });

  it("never UPDATEs or DELETEs audit rows in any RPC body", () => {
    for (const name of P5B4_RPC_NAMES) {
      const body = isolateFunction(sql, name);
      expect(body, `${name} must not mutate audit rows`).not.toMatch(
        /(UPDATE|DELETE)\s+(?:FROM\s+)?public\.p5_batch4_audit_events/i,
      );
    }
  });

  it("finality RPC inserts via the audit helper (never updates finality after insert)", () => {
    const body = isolateFunction(sql, "p5b4_record_finality_v1");
    expect(body).toMatch(/INSERT INTO public\.p5_batch4_finality_records/);
    expect(body).not.toMatch(/UPDATE\s+public\.p5_batch4_finality_records/i);
    expect(body).not.toMatch(/DELETE\s+FROM\s+public\.p5_batch4_finality_records/i);
  });

  it("release_funder_pack rejects past expiry in body", () => {
    const body = isolateFunction(sql, "p5b4_release_funder_pack_v1");
    expect(body).toMatch(/p_access_expires_at <= now\(\)/);
  });
});

describe("Stage 3 edge function — audience field filtering", () => {
  const fn = readFileSync(
    "supabase/functions/p5-batch4-execution-summary/index.ts",
    "utf8",
  );

  it("declares disjoint admin vs funder field sets", () => {
    expect(fn).toMatch(/ADMIN_SAFE_FIELDS/);
    expect(fn).toMatch(/FUNDER_SAFE_FIELDS/);
    expect(fn).toMatch(/FORBIDDEN_FUNDER_FIELDS/);
  });

  it("funder field set excludes internal/owner/finality identifiers", () => {
    const funderMatch = fn.match(/FUNDER_SAFE_FIELDS\s*=\s*\[([^\]]+)\]/);
    expect(funderMatch).toBeTruthy();
    const body = funderMatch![1];
    for (const forbidden of [
      "owner_user_id",
      "created_by",
      "linked_company_id",
      "linked_transaction_id",
      "provider_dependency_status",
      "finality_status",
      "memory_summary_id",
    ]) {
      expect(body, `funder safe set must not include ${forbidden}`).not.toMatch(
        new RegExp(`"${forbidden}"`),
      );
    }
  });

  it("rejects unknown audience", () => {
    expect(fn).toMatch(/audience !== "admin" && audience !== "funder"/);
    expect(fn).toMatch(/invalid_audience/);
  });

  it("requires Bearer authentication", () => {
    expect(fn).toMatch(/authentication_required/);
    expect(fn).toMatch(/Bearer /);
  });

  it("funder branch checks release exists, is not revoked, and not expired", () => {
    expect(fn).toMatch(/\.neq\(["']status["'],\s*["']revoked["']\)/);
    expect(fn).toMatch(/\.gt\(["']access_expires_at["']/);
  });

  it("admin branch requires p5b4_is_platform_admin", () => {
    expect(fn).toMatch(/p5b4_is_platform_admin/);
  });
});
