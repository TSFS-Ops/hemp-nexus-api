/**
 * P-5 Batch 2 — Stage 1 enum drift guard.
 *
 * Parses the Stage 1 migration (the one that creates `p5b2_kyc_record_type`)
 * and asserts that every TS constant in `src/lib/p5-batch2/constants.ts`
 * matches the Postgres enum body verbatim. Adding a value to either side
 * without the other will fail the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  P5B2_KYC_RECORD_TYPES,
  P5B2_EVIDENCE_STATUSES,
  P5B2_EVIDENCE_RATINGS,
  P5B2_REQUIREMENT_LEVELS,
  P5B2_REJECTION_REASONS,
  P5B2_PROVIDER_STATUSES,
  P5B2_REPLACEMENT_REASONS,
} from "@/lib/p5-batch2/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const stage1 = bodies.find((b) =>
    /CREATE TYPE public\.p5b2_kyc_record_type AS ENUM/.test(b),
  );
  if (!stage1) {
    throw new Error(
      "P-5 Batch 2 Stage 1 migration (creating p5b2_kyc_record_type) not found",
    );
  }
  return stage1;
}

function parseEnumBody(sql: string, typeName: string): string[] {
  const re = new RegExp(
    `CREATE TYPE public\\.${typeName} AS ENUM\\s*\\(([\\s\\S]*?)\\)`,
    "i",
  );
  const m = sql.match(re);
  if (!m) throw new Error(`Could not parse enum body for public.${typeName}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("P-5 Batch 2 — Stage 1 enum drift guard", () => {
  const sql = loadStage1Sql();

  it("p5b2_kyc_record_type matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_kyc_record_type")).toEqual([
      ...P5B2_KYC_RECORD_TYPES,
    ]);
  });

  it("p5b2_evidence_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_evidence_status")).toEqual([
      ...P5B2_EVIDENCE_STATUSES,
    ]);
  });

  it("p5b2_evidence_rating matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_evidence_rating")).toEqual([
      ...P5B2_EVIDENCE_RATINGS,
    ]);
  });

  it("p5b2_requirement_level matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_requirement_level")).toEqual([
      ...P5B2_REQUIREMENT_LEVELS,
    ]);
  });

  it("p5b2_rejection_reason matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_rejection_reason")).toEqual([
      ...P5B2_REJECTION_REASONS,
    ]);
  });

  it("p5b2_provider_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_provider_status")).toEqual([
      ...P5B2_PROVIDER_STATUSES,
    ]);
  });

  it("p5b2_replacement_reason matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5b2_replacement_reason")).toEqual([
      ...P5B2_REPLACEMENT_REASONS,
    ]);
  });
});
