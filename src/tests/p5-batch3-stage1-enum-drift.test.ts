/**
 * P-5 Batch 3 — Stage 1 enum drift guard.
 *
 * Parses the Stage 1 migration (the one that creates `p5_batch3_funder_role`)
 * and asserts that every TS constant in `src/lib/p5-batch3/constants.ts`
 * matches the Postgres enum body verbatim. Adding a value to either side
 * without the other will fail the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  P5B3_FUNDER_ROLES,
  P5B3_FUNDER_ORG_STATUSES,
  P5B3_FUNDER_USER_STATUSES,
  P5B3_ACCESS_GRANT_STATUSES,
  P5B3_FUNDER_STATUSES,
  P5B3_REQUEST_STATUSES,
  P5B3_REQUEST_CATEGORIES,
  P5B3_OUTCOME_TYPES,
  P5B3_EXIT_REASONS,
} from "@/lib/p5-batch3/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const stage1 = bodies.find((b) =>
    /CREATE TYPE public\.p5_batch3_funder_role AS ENUM/.test(b),
  );
  if (!stage1) {
    throw new Error(
      "P-5 Batch 3 Stage 1 migration (creating p5_batch3_funder_role) not found",
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

describe("P-5 Batch 3 — Stage 1 enum drift guard", () => {
  const sql = loadStage1Sql();

  it("p5_batch3_funder_role matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_funder_role")).toEqual([...P5B3_FUNDER_ROLES]);
  });
  it("p5_batch3_funder_org_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_funder_org_status")).toEqual([
      ...P5B3_FUNDER_ORG_STATUSES,
    ]);
  });
  it("p5_batch3_funder_user_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_funder_user_status")).toEqual([
      ...P5B3_FUNDER_USER_STATUSES,
    ]);
  });
  it("p5_batch3_access_grant_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_access_grant_status")).toEqual([
      ...P5B3_ACCESS_GRANT_STATUSES,
    ]);
  });
  it("p5_batch3_funder_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_funder_status")).toEqual([
      ...P5B3_FUNDER_STATUSES,
    ]);
  });
  it("p5_batch3_request_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_request_status")).toEqual([
      ...P5B3_REQUEST_STATUSES,
    ]);
  });
  it("p5_batch3_request_category matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_request_category")).toEqual([
      ...P5B3_REQUEST_CATEGORIES,
    ]);
  });
  it("p5_batch3_outcome_type matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_outcome_type")).toEqual([...P5B3_OUTCOME_TYPES]);
  });
  it("p5_batch3_exit_reason matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_batch3_exit_reason")).toEqual([...P5B3_EXIT_REASONS]);
  });
});
