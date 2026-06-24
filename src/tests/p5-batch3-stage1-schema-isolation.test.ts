/**
 * P-5 Batch 3 — Stage 1 schema isolation guard.
 *
 * Asserts that the Stage 1 migration:
 *  1. Creates every table under the `p5_batch3_*` prefix.
 *  2. Enables RLS on every Batch 3 table.
 *  3. Issues the required GRANTs to authenticated + service_role.
 *  4. Has no policies that would allow funder users to INSERT, UPDATE
 *     or DELETE (Stage 3 will introduce server-authoritative writes).
 *  5. Does NOT touch any Batch 1 / Batch 2 table, function, RPC, or
 *     business-row tables (trade/POI/WaD/billing/payment/etc).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { P5B3_TABLES } from "@/lib/p5-batch3/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const stage1 = bodies.find((b) =>
    /CREATE TYPE public\.p5_batch3_funder_role AS ENUM/.test(b),
  );
  if (!stage1) throw new Error("Batch 3 Stage 1 migration not found");
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
  // Business rows that must never be mutated by Batch 3 Stage 1
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

describe("P-5 Batch 3 — Stage 1 schema isolation", () => {
  const sql = loadStage1Sql();

  it("creates every Batch 3 table under the p5_batch3_* prefix", () => {
    for (const t of P5B3_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${t}\\b`));
    }
  });

  it("enables RLS on every Batch 3 table", () => {
    for (const t of P5B3_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`),
      );
    }
  });

  it("grants service_role on every Batch 3 table", () => {
    for (const t of P5B3_TABLES) {
      expect(sql).toMatch(
        new RegExp(`GRANT ALL ON public\\.${t} TO service_role`),
      );
    }
  });

  it("grants only SELECT to authenticated (no DML at table level)", () => {
    for (const t of P5B3_TABLES) {
      expect(sql).toMatch(
        new RegExp(`GRANT SELECT ON public\\.${t} TO authenticated`),
      );
      // Must NOT grant write privileges directly to authenticated:
      expect(sql).not.toMatch(
        new RegExp(
          `GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\\.${t}[^;]*TO authenticated`,
        ),
      );
    }
  });

  it("never defines INSERT/UPDATE/DELETE policies for authenticated funder users", () => {
    // Stage 1 must rely on service_role + Stage 3 RPCs for all writes.
    const dmlPolicy =
      /CREATE POLICY[^;]+ON public\.p5_batch3_[^;]+FOR (INSERT|UPDATE|DELETE)[^;]+TO authenticated/i;
    expect(dmlPolicy.test(sql)).toBe(false);
  });

  it("audit and download tables are append-only at the policy layer", () => {
    // Only SELECT policies should mention these two tables.
    const auditPolicies = sql.match(
      /CREATE POLICY[^;]+ON public\.p5_batch3_funder_audit_events[^;]+;/g,
    ) ?? [];
    for (const p of auditPolicies) {
      expect(p).toMatch(/FOR SELECT/i);
    }
    const dlPolicies = sql.match(
      /CREATE POLICY[^;]+ON public\.p5_batch3_funder_downloads[^;]+;/g,
    ) ?? [];
    for (const p of dlPolicies) {
      expect(p).toMatch(/FOR SELECT/i);
    }
  });

  it("does not create or alter Batch 1 / Batch 2 / business tables", () => {
    for (const tok of FORBIDDEN_TABLE_TOKENS) {
      const offending = new RegExp(
        `\\b(CREATE|ALTER|DROP)\\s+TABLE[^;]*\\b${tok}\\b`,
        "i",
      );
      expect(offending.test(sql)).toBe(false);
    }
  });

  it("does not reference Batch 1 / Batch 2 RPC or edge-fn names", () => {
    expect(sql).not.toMatch(/p5b2_[a-z_]+_v[0-9]+/i);
    expect(sql).not.toMatch(/atomic_generate_poi/i);
    expect(sql).not.toMatch(/atomic_token_burn/i);
  });
});
