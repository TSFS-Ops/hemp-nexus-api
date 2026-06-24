/**
 * P-5 Batch 1 — Stage 1 drift guard.
 *
 * Mirrors the `wad-status-drift-guard` pattern: parses the Stage 1 migration
 * file and asserts that every TS constant in `src/lib/p5-governance/constants.ts`
 * matches the Postgres enum body verbatim. If a developer adds a status,
 * reason code or provider status to one side without the other, this test
 * fails the build before the drift can reach production.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  P5_STATUSES,
  P5_PROVIDER_STATUSES,
  P5_RULE_SEVERITIES,
  P5_ACTOR_TYPES,
  P5_REASON_CODES,
  P5_NEW_ROLES,
} from "@/lib/p5-governance/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  // Stage 1 is identified by the first migration that creates `p5_status`.
  const stage1 = bodies.find((b) => /CREATE TYPE public\.p5_status AS ENUM/.test(b));
  if (!stage1) throw new Error("Stage 1 P-5 migration (creating p5_status) not found");
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

function parseAddedRoles(sql: string): string[] {
  return [...sql.matchAll(/ALTER TYPE public\.app_role ADD VALUE '([^']+)'/g)].map(
    (x) => x[1],
  );
}

describe("P-5 Batch 1 — Stage 1 enum drift guard", () => {
  const sql = loadStage1Sql();

  it("p5_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_status")).toEqual([...P5_STATUSES]);
  });

  it("p5_provider_status matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_provider_status")).toEqual([...P5_PROVIDER_STATUSES]);
  });

  it("p5_rule_severity matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_rule_severity")).toEqual([...P5_RULE_SEVERITIES]);
  });

  it("p5_actor_type matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_actor_type")).toEqual([...P5_ACTOR_TYPES]);
  });

  it("p5_reason_code matches TS SSOT exactly", () => {
    expect(parseEnumBody(sql, "p5_reason_code")).toEqual([...P5_REASON_CODES]);
  });

  it("app_role enum gains all seven new P-5 roles", () => {
    const added = parseAddedRoles(sql);
    for (const role of P5_NEW_ROLES) {
      expect(added).toContain(role);
    }
  });
});
