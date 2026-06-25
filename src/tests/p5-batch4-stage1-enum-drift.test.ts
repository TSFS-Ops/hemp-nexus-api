/**
 * P-5 Batch 4 — Stage 1 enum drift guard.
 *
 * Parses the Stage 1 migration (the one that creates
 * `p5_batch4_process_type`) and asserts that every TS controlled
 * vocabulary in `src/lib/p5-batch4/constants.ts` matches the Postgres
 * enum body verbatim. Adding a value to either side without the other
 * will fail the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  P5B4_PROCESS_TYPES,
  P5B4_EXECUTION_STATUSES,
  P5B4_READINESS_STATUSES,
  P5B4_MILESTONE_KEYS,
  P5B4_MILESTONE_STATUSES,
  P5B4_MANDATORY_TYPES,
  P5B4_EVIDENCE_STATUSES,
  P5B4_BLOCKER_TYPES,
  P5B4_BLOCKER_STATUSES,
  P5B4_BLOCKER_KEYS,
  P5B4_TASK_STATUSES,
  P5B4_FUNDER_RELEASE_STATUSES,
  P5B4_FINALITY_OUTCOMES,
  P5B4_RESPONSIBLE_PARTY_TYPES,
  P5B4_SOURCE_CHANNELS,
  P5B4_ROLE_KEYS,
} from "@/lib/p5-batch4/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadStage1Sql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const stage1 = bodies.find((b) =>
    /CREATE TYPE public\.p5_batch4_process_type AS ENUM/.test(b),
  );
  if (!stage1) {
    throw new Error(
      "P-5 Batch 4 Stage 1 migration (creating p5_batch4_process_type) not found",
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

describe("P-5 Batch 4 — Stage 1 enum drift guard", () => {
  const sql = loadStage1Sql();

  const cases: Array<[string, readonly string[]]> = [
    ["p5_batch4_process_type", P5B4_PROCESS_TYPES],
    ["p5_batch4_execution_status", P5B4_EXECUTION_STATUSES],
    ["p5_batch4_readiness_status", P5B4_READINESS_STATUSES],
    ["p5_batch4_milestone_key", P5B4_MILESTONE_KEYS],
    ["p5_batch4_milestone_status", P5B4_MILESTONE_STATUSES],
    ["p5_batch4_mandatory_type", P5B4_MANDATORY_TYPES],
    ["p5_batch4_evidence_status", P5B4_EVIDENCE_STATUSES],
    ["p5_batch4_blocker_type", P5B4_BLOCKER_TYPES],
    ["p5_batch4_blocker_status", P5B4_BLOCKER_STATUSES],
    ["p5_batch4_blocker_key", P5B4_BLOCKER_KEYS],
    ["p5_batch4_task_status", P5B4_TASK_STATUSES],
    ["p5_batch4_funder_release_status", P5B4_FUNDER_RELEASE_STATUSES],
    ["p5_batch4_finality_outcome", P5B4_FINALITY_OUTCOMES],
    ["p5_batch4_responsible_party_type", P5B4_RESPONSIBLE_PARTY_TYPES],
    ["p5_batch4_source_channel", P5B4_SOURCE_CHANNELS],
    ["p5_batch4_role_key", P5B4_ROLE_KEYS],
  ];

  for (const [typeName, ssot] of cases) {
    it(`${typeName} matches TS SSOT exactly`, () => {
      expect(parseEnumBody(sql, typeName)).toEqual([...ssot]);
    });
  }
});
