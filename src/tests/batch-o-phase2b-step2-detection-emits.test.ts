/**
 * Batch O Phase 2b Step 2 — local idempotency surface tests.
 *
 * Asserts:
 *   • The migration creating `match_legacy_detection_emits` exists with the
 *     required columns, unique key, RLS enabled, and no broad write policy.
 *   • `audit_logs` is NOT modified by this phase.
 *   • No new triggers / outbound notification paths added.
 *   • The detection-signature helper is deterministic and order-insensitive.
 *
 * Pure file reads + a dynamic import of the shared helper. No DB, no network.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  computeDetectionSignature,
  DETECTION_SIGNATURE_VERSION,
} from "../../supabase/functions/_shared/match-detection-signature";

const root = process.cwd();
const migrationsDir = join(root, "supabase/migrations");

function migrationsMentioning(pattern: RegExp): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), "utf8"),
    }))
    .filter((m) => pattern.test(m.sql))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("Batch O Phase 2b Step 2 — match_legacy_detection_emits migration", () => {
  const matches = migrationsMentioning(/match_legacy_detection_emits/i);
  const latest = matches[matches.length - 1];

  it("at least one migration creates match_legacy_detection_emits", () => {
    expect(matches.length).toBeGreaterThan(0);
  });

  it("creates the table with the required columns", () => {
    expect(latest).toBeTruthy();
    const sql = latest.sql;
    expect(sql).toMatch(/CREATE\s+TABLE[^;]*public\.match_legacy_detection_emits/i);
    expect(sql).toMatch(/match_id\s+uuid\s+NOT\s+NULL/i);
    expect(sql).toMatch(/REFERENCES\s+public\.matches\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toMatch(/signature\s+text\s+NOT\s+NULL/i);
    expect(sql).toMatch(/reasons\s+jsonb\s+NOT\s+NULL/i);
    expect(sql).toMatch(/emitted_at\s+timestamptz\s+NOT\s+NULL/i);
    expect(sql).toMatch(/emitted_by_user_id\s+uuid/i);
  });

  it("declares unique (match_id, signature)", () => {
    const sql = latest.sql;
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*match_id\s*,\s*signature\s*\)|CREATE\s+UNIQUE\s+INDEX[^;]*\(\s*match_id\s*,\s*signature\s*\)/i,
    );
  });

  it("forbids empty signature and forces reasons to be a JSON array", () => {
    const sql = latest.sql;
    expect(sql).toMatch(/length\s*\(\s*signature\s*\)\s*>\s*0/i);
    expect(sql).toMatch(/jsonb_typeof\s*\(\s*reasons\s*\)\s*=\s*'array'/i);
  });

  it("enables RLS and ships no broad anon/authenticated write policy", () => {
    const sql = latest.sql;
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.match_legacy_detection_emits\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    // No INSERT / UPDATE / DELETE policy may exist — writes go through future
    // service-role RPC only. SELECT policy for admins is permitted.
    const policyMatches = sql.match(/CREATE\s+POLICY[^;]+;/gi) ?? [];
    for (const p of policyMatches) {
      // Reject permissive write policies. Only FOR SELECT is allowed.
      expect(p).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
      // Reject anon role
      expect(p).not.toMatch(/\bTO\s+anon\b/i);
    }
  });

  it("does not perform DDL/DML against audit_logs", () => {
    // The comment header may mention "audit_logs" by name to explain intent;
    // what we forbid is actual schema or data operations against it.
    const sql = latest.sql;
    expect(sql).not.toMatch(/ALTER\s+TABLE[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/UPDATE\s+[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/DELETE\s+FROM[^;]*\baudit_logs\b/i);
    expect(sql).not.toMatch(/DROP[^;]*\baudit_logs\b/i);
  });

  it("adds no triggers or notification fan-out", () => {
    const sql = latest.sql;
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).not.toMatch(/pg_notify/i);
    expect(sql).not.toMatch(/notification_dispatch|notification-dispatch/i);
  });
});

describe("Batch O Phase 2b Step 2 — audit_logs untouched in this migration window", () => {
  it("the new migration touches match_legacy_detection_emits but not audit_logs", () => {
    const matches = migrationsMentioning(/match_legacy_detection_emits/i);
    const latest = matches[matches.length - 1];
    expect(latest.sql).not.toMatch(/ALTER\s+TABLE[^;]*audit_logs/i);
    expect(latest.sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*audit_logs/i);
  });
});

describe("Batch O Phase 2b Step 2 — detection signature helper", () => {
  const M = "11111111-1111-1111-1111-111111111111";

  it("returns versioned shape v1:<matchId>:<segment>", () => {
    expect(computeDetectionSignature(M, ["a"])).toBe(
      `${DETECTION_SIGNATURE_VERSION}:${M}:a`,
    );
  });

  it("is deterministic for the same reasons in the same order", () => {
    const a = computeDetectionSignature(M, ["x", "y"]);
    const b = computeDetectionSignature(M, ["x", "y"]);
    expect(a).toBe(b);
  });

  it("is order-insensitive (sorts reasons before hashing)", () => {
    const a = computeDetectionSignature(M, ["b", "a"]);
    const b = computeDetectionSignature(M, ["a", "b"]);
    expect(a).toBe(b);
  });

  it("de-duplicates repeated reasons", () => {
    const a = computeDetectionSignature(M, ["a", "a", "b"]);
    const b = computeDetectionSignature(M, ["a", "b"]);
    expect(a).toBe(b);
  });

  it("different reason sets produce different signatures", () => {
    const a = computeDetectionSignature(M, ["a"]);
    const b = computeDetectionSignature(M, ["b"]);
    expect(a).not.toBe(b);
  });

  it("different match ids with same reasons produce different signatures", () => {
    const a = computeDetectionSignature(M, ["a"]);
    const b = computeDetectionSignature(
      "22222222-2222-2222-2222-222222222222",
      ["a"],
    );
    expect(a).not.toBe(b);
  });

  it("empty reasons array uses the sentinel segment", () => {
    expect(computeDetectionSignature(M, [])).toBe(
      `${DETECTION_SIGNATURE_VERSION}:${M}:none`,
    );
  });

  it("requires a match id", () => {
    expect(() => computeDetectionSignature("", ["a"])).toThrow();
  });
});
