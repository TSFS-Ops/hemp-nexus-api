/**
 * P-5 Batch 4 — Stage 1 schema isolation guard.
 *
 * Asserts that the Stage 1 migration:
 *  1. Creates every table under the `p5_batch4_*` prefix.
 *  2. Enables RLS on every Batch 4 table.
 *  3. Issues the required GRANTs to authenticated + service_role
 *     (SELECT-only to authenticated; service_role full access).
 *  4. Has no policies that would allow authenticated users to INSERT,
 *     UPDATE or DELETE (Stage 3 introduces server-authoritative writes).
 *  5. Audit and finality tables are append-only at the policy layer.
 *  6. Finality lock trigger and audit-mutation block trigger are present.
 *  7. Does NOT touch any Batch 1 / Batch 2 / Batch 3 table or
 *     business-row table (trade/POI/WaD/billing/payment/etc).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { P5B4_TABLES } from "@/lib/p5-batch4/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const stage1 = bodies.find((b) =>
    /CREATE TYPE public\.p5_batch4_process_type AS ENUM/.test(b),
  );
  if (!stage1) throw new Error("Batch 4 Stage 1 migration not found");
  return stage1;
}

const FORBIDDEN_TABLE_TOKENS = [
  // Batch 1
  "p5_governance_readiness_cases",
  "p5_governance_evidence_items",
  "p5_governance_audit_events",
  // Batch 2
  "p5_batch2_kyc_records",
  "p5_batch2_evidence_items",
  "p5_batch2_evidence_versions",
  "p5_batch2_evidence_packs",
  "p5_batch2_tasks",
  // Batch 3
  "p5_batch3_funder_organisations",
  "p5_batch3_funder_users",
  "p5_batch3_funder_access_grants",
  "p5_batch3_funder_requests",
  "p5_batch3_funder_outcomes",
  "p5_batch3_funder_audit_events",
  "p5_batch3_funder_downloads",
  // Business rows that must never be mutated by Batch 4 Stage 1
  "trade_requests",
  "trade_orders",
  "trade_approvals",
  "pois",
  "poi_engagements",
  "wads",
  "wad_attestations",
  "token_ledger",
  "token_balances",
  "token_purchases",
  "payment_disputes",
  "business_decisions",
  "fund_flows",
  "matches",
] as const;

describe("P-5 Batch 4 — Stage 1 schema isolation", () => {
  const sql = loadStage1Sql();

  it("creates every Batch 4 table under the p5_batch4_* prefix", () => {
    for (const t of P5B4_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${t}\\b`));
    }
  });

  it("enables RLS on every Batch 4 table", () => {
    for (const t of P5B4_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`),
      );
    }
  });

  it("grants service_role on every Batch 4 table", () => {
    for (const t of P5B4_TABLES) {
      expect(sql).toMatch(
        new RegExp(`GRANT ALL ON public\\.${t} TO service_role`),
      );
    }
  });

  it("grants only SELECT to authenticated (no DML at table level)", () => {
    for (const t of P5B4_TABLES) {
      expect(sql).toMatch(
        new RegExp(`GRANT SELECT ON public\\.${t} TO authenticated`),
      );
      expect(sql).not.toMatch(
        new RegExp(
          `GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\\.${t}[^;]*TO authenticated`,
        ),
      );
    }
  });

  it("grants nothing to anon on any Batch 4 table", () => {
    for (const t of P5B4_TABLES) {
      expect(sql).not.toMatch(
        new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon`, "i"),
      );
    }
  });

  it("never defines INSERT/UPDATE/DELETE policies for authenticated users", () => {
    const dmlPolicy =
      /CREATE POLICY[^;]+ON public\.p5_batch4_[^;]+FOR (INSERT|UPDATE|DELETE)[^;]+TO authenticated/i;
    expect(dmlPolicy.test(sql)).toBe(false);
  });

  it("audit and finality tables are append-only at the policy layer", () => {
    for (const t of [
      "p5_batch4_audit_events",
      "p5_batch4_finality_records",
    ]) {
      const policies = sql.match(
        new RegExp(`CREATE POLICY[^;]+ON public\\.${t}[^;]+;`, "g"),
      ) ?? [];
      for (const p of policies) {
        expect(p).toMatch(/FOR SELECT/i);
      }
    }
  });

  it("installs the finality-lock trigger on p5_batch4_finality_records", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER[^;]+BEFORE UPDATE ON public\.p5_batch4_finality_records[^;]+p5b4_lock_finality/i,
    );
  });

  it("installs the audit-mutation block trigger on p5_batch4_audit_events", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER[^;]+BEFORE (UPDATE|DELETE)[^;]*ON public\.p5_batch4_audit_events[^;]+p5b4_block_audit_mutation/i,
    );
  });

  it("does not create or alter Batch 1 / Batch 2 / Batch 3 / business tables", () => {
    for (const tok of FORBIDDEN_TABLE_TOKENS) {
      const offending = new RegExp(
        `\\b(CREATE|ALTER|DROP)\\s+TABLE[^;]*\\b${tok}\\b`,
        "i",
      );
      expect(offending.test(sql)).toBe(false);
    }
  });

  it("does not reference Batch 1 / Batch 2 / Batch 3 RPC or edge-fn names", () => {
    expect(sql).not.toMatch(/p5b2_[a-z_]+_v[0-9]+/i);
    expect(sql).not.toMatch(/p5b3_[a-z_]+_v[0-9]+/i);
    expect(sql).not.toMatch(/atomic_generate_poi/i);
    expect(sql).not.toMatch(/atomic_token_burn/i);
  });
});
