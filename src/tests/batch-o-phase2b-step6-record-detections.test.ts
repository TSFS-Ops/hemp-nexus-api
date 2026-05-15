/**
 * Batch O Phase 2b Step 6 — admin_record_legacy_detections RPC + edge function
 * source-level safety tests.
 *
 * These are static-source assertions (no DB roundtrip): they verify the
 * shape and isolation of the migration and edge function so the build
 * loop catches regressions without needing a Postgres connection in CI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const EDGE_FN_PATH =
  "supabase/functions/admin-match-legacy-record-detections/index.ts";
const SHARED_DIR = "supabase/functions/_shared";

function findMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (
      body.includes("CREATE OR REPLACE FUNCTION public.admin_record_legacy_detections")
    ) {
      return body;
    }
  }
  throw new Error("admin_record_legacy_detections migration not found");
}

const migrationSql = findMigration();
const edgeSrc = readFileSync(EDGE_FN_PATH, "utf8");

describe("Step 6 — admin_record_legacy_detections RPC", () => {
  it("is SECURITY DEFINER with explicit search_path", () => {
    expect(migrationSql).toMatch(/SECURITY DEFINER/);
    expect(migrationSql).toMatch(/SET search_path = public/);
  });

  it("revokes default execute and grants only to service_role", () => {
    expect(migrationSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_record_legacy_detections\(uuid, uuid\[\]\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_record_legacy_detections\(uuid, uuid\[\]\) TO service_role/,
    );
    expect(migrationSql).not.toMatch(/GRANT EXECUTE[^;]*TO authenticated/);
    expect(migrationSql).not.toMatch(/GRANT EXECUTE[^;]*TO anon/);
  });

  it("requires admin (is_admin gate) and emits not_admin error", () => {
    expect(migrationSql).toMatch(/public\.is_admin\(p_admin_user_id\)/);
    expect(migrationSql).toMatch(/RAISE EXCEPTION 'not_admin'/);
  });

  it("inserts into match_legacy_detection_emits with ON CONFLICT DO NOTHING", () => {
    expect(migrationSql).toMatch(
      /INSERT INTO public\.match_legacy_detection_emits[\s\S]*ON CONFLICT \(match_id, signature\) DO NOTHING/,
    );
  });

  it("computes signature with the v1: prefix and sorted reasons", () => {
    expect(migrationSql).toMatch(/'v1:'\s*\|\|\s*v_row\.id/);
    expect(migrationSql).toMatch(/string_agg\(r,\s*','\s+ORDER BY r\)/);
    expect(migrationSql).toMatch(/'none'/); // empty-reasons sentinel
  });

  it("writes match.legacy_state_reconciliation_required ONLY when insert succeeded", () => {
    // Slice just the function body to avoid matching docstring mentions.
    const start = migrationSql.indexOf("BEGIN", migrationSql.indexOf("CREATE OR REPLACE FUNCTION public.admin_record_legacy_detections"));
    const end = migrationSql.indexOf("END;\n$$", start);
    const body = migrationSql.slice(start, end);
    const auditIdx = body.indexOf("'match.legacy_state_reconciliation_required'");
    const guardIdx = body.indexOf("IF coalesce(v_inserted, false) THEN");
    const elseIdx = body.indexOf("ELSE", guardIdx);
    expect(auditIdx).toBeGreaterThan(guardIdx);
    expect(auditIdx).toBeLessThan(elseIdx);
  });

  it("audit row carries required forensic fields", () => {
    for (const key of [
      "user_visibility_after",
      "admin_queue_created",
      "progression_blocked",
      "credit_burned",
      "payment_event_created",
      "detected_at",
      "signature",
      "reasons",
    ]) {
      expect(migrationSql).toContain(`'${key}'`);
    }
    expect(migrationSql).toMatch(/'credit_burned',\s*false/);
    expect(migrationSql).toMatch(/'payment_event_created',\s*false/);
    expect(migrationSql).toMatch(/'progression_blocked',\s*true/);
  });

  it("does NOT mutate public.matches (no UPDATE matches in this function)", () => {
    // Slice just this function's body to avoid catching unrelated migrations.
    const start = migrationSql.indexOf(
      "CREATE OR REPLACE FUNCTION public.admin_record_legacy_detections",
    );
    const end = migrationSql.indexOf("REVOKE ALL ON FUNCTION public.admin_record_legacy_detections");
    const body = migrationSql.slice(start, end);
    expect(body).not.toMatch(/UPDATE\s+public\.matches/i);
    expect(body).not.toMatch(/DELETE\s+FROM\s+public\.matches/i);
  });

  it("touches no out-of-scope tables (POI / WaD / payment / credit / notification / rating)", () => {
    const start = migrationSql.indexOf(
      "CREATE OR REPLACE FUNCTION public.admin_record_legacy_detections",
    );
    const end = migrationSql.indexOf("REVOKE ALL ON FUNCTION public.admin_record_legacy_detections");
    const body = migrationSql.slice(start, end).toLowerCase();
    // Only check for forbidden table/module references — not column names like poi_state.
    for (const banned of [
      "poi_engagements",
      "poi_documents",
      "wads",
      "wad_",
      "payments",
      "paystack",
      "token_ledger",
      "credit_purchases",
      "notification_dispatch",
      "email_queue",
      "ratings_signals",
      "compliance_checks",
    ]) {
      expect(body, `must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("returns scanned/recorded/already_recorded/skipped/summary keys", () => {
    expect(migrationSql).toMatch(/'scanned'/);
    expect(migrationSql).toMatch(/'recorded'/);
    expect(migrationSql).toMatch(/'already_recorded'/);
    expect(migrationSql).toMatch(/'skipped'/);
    expect(migrationSql).toMatch(/'summary'/);
  });
});

describe("Step 6 — admin-match-legacy-record-detections edge function", () => {
  it("requires Idempotency-Key", () => {
    expect(edgeSrc).toMatch(/assertIdempotencyKey/);
  });

  it("verifies authenticated platform admin via is_admin RPC", () => {
    expect(edgeSrc).toMatch(/admin\.auth\.getUser/);
    expect(edgeSrc).toMatch(/admin\.rpc\(\s*"is_admin"/);
    expect(edgeSrc).toMatch(/error: "FORBIDDEN"/);
  });

  it("uses a strict Zod schema and rejects unknown fields", () => {
    expect(edgeSrc).toMatch(/z\s*\.?\s*object\(\s*\{[\s\S]*?match_ids[\s\S]*?\}\s*\)[\s\S]*?\.strict\(\)/);
  });

  it("caps match_ids at 500", () => {
    expect(edgeSrc).toMatch(/MAX_MATCH_IDS\s*=\s*500/);
    expect(edgeSrc).toMatch(/\.max\(MAX_MATCH_IDS\)/);
  });

  it("delegates to admin_record_legacy_detections RPC and never to other RPCs", () => {
    expect(edgeSrc).toMatch(/admin\.rpc\(\s*"admin_record_legacy_detections"/);
    // No POI/payment/notification helpers imported.
    expect(edgeSrc).not.toMatch(/notification-dispatch/);
    expect(edgeSrc).not.toMatch(/atomic_generate_poi/);
    expect(edgeSrc).not.toMatch(/atomic_token_burn/);
    expect(edgeSrc).not.toMatch(/paystack/i);
    expect(edgeSrc).not.toMatch(/resend/i);
  });

  it("imports only cors + idempotency + supabase + zod helpers", () => {
    const importSpecifiers = [
      ...edgeSrc.matchAll(/from\s+["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(importSpecifiers.length).toBeGreaterThan(0);
    for (const spec of importSpecifiers) {
      expect(spec).toMatch(
        /(supabase-js|deno\.land\/x\/zod|_shared\/cors|_shared\/idempotency)/,
      );
    }
  });
});

describe("Step 6 — signature parity with shared helper", () => {
  it("signature helper exists and produces v1:<id>:<sortedReasons|none>", async () => {
    const helper = readFileSync(join(SHARED_DIR, "match-detection-signature.ts"), "utf8");
    expect(helper).toMatch(/v1/);
    // Re-import the helper at runtime to verify behaviour.
    const mod = await import("../../supabase/functions/_shared/match-detection-signature.ts");
    expect(mod.computeDetectionSignature("abc", ["b", "a", "a"])).toBe("v1:abc:a,b");
    expect(mod.computeDetectionSignature("abc", [])).toBe("v1:abc:none");
  });
});
