/**
 * P-5 Batch 5 — Phase 3 tests
 * Memory writer + exclusion rules.
 *
 * The actual writer is a SECURITY DEFINER RPC that requires service_role.
 * We do not embed service_role in client tests, so these tests cover:
 *   - the client-side forbidden-field stripper (mirrors the DB function),
 *   - the exclusion / permitted source vocabularies,
 *   - the existence and shape of the DB writer / pattern detector / stripper
 *     in the latest Phase 3 migration source.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  P5B5_FORBIDDEN_FIELDS,
  P5B5_MEMORY_EXCLUDED_OUTCOMES,
  P5B5_MEMORY_FORBIDDEN_SOURCES,
  P5B5_MEMORY_PERMITTED_SOURCES,
  P5B5_REPEATED_PATTERN_RULE,
  p5b5StripForbiddenFields,
} from "@/lib/p5-batch5/memory-writer";

function latestPhase3Migration(): string {
  const dir = "supabase/migrations";
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Phase 3 introduces the writer function name.
  for (let i = files.length - 1; i >= 0; i--) {
    const body = fs.readFileSync(path.join(dir, files[i]), "utf8");
    if (body.includes("p5b5_write_memory_from_finality")) return body;
  }
  throw new Error("Phase 3 migration not found");
}

describe("p5-batch5 phase 3 — forbidden-field stripping", () => {
  it("removes raw bank details", () => {
    const out = p5b5StripForbiddenFields({
      iban: "GB00X",
      account_number: "1234",
      bank_account_number: "abc",
      ok: "kept",
    });
    expect(out).toEqual({ ok: "kept" });
  });

  it("removes credentials, tokens and API keys", () => {
    const out = p5b5StripForbiddenFields({
      api_key: "sk_x",
      api_secret: "s",
      access_token: "t",
      refresh_token: "r",
      bearer_token: "b",
      webhook_secret: "w",
      password: "p",
      kept: 1,
    });
    expect(out).toEqual({ kept: 1 });
  });

  it("removes provider raw payloads", () => {
    const out = p5b5StripForbiddenFields({
      raw_payload: { x: 1 },
      raw_provider_payload: { y: 2 },
      provider_raw: { z: 3 },
      summary: "ok",
    });
    expect(out).toEqual({ summary: "ok" });
  });

  it("removes private/internal notes and draft AI", () => {
    const out = p5b5StripForbiddenFields({
      private_notes: "x",
      internal_notes: "y",
      internal_commentary: "z",
      support_notes: "s",
      ai_draft: { a: 1 },
      ai_suggestion: "do this",
      draft_suggestion: "no",
      decision_summary: "kept",
    });
    expect(out).toEqual({ decision_summary: "kept" });
  });

  it("removes PII not required for business purpose", () => {
    const out = p5b5StripForbiddenFields({
      email: "x@y",
      phone: "+1",
      date_of_birth: "2000-01-01",
      id_number: "z",
      passport_number: "p",
      role: "kept",
    });
    expect(out).toEqual({ role: "kept" });
  });

  it("strips recursively inside nested objects and arrays", () => {
    const out = p5b5StripForbiddenFields({
      provider: { api_key: "x", name: "kept" },
      events: [
        { token: "t", code: "ok" },
        { raw_payload: { x: 1 }, code: "ok2" },
      ],
    });
    expect(out).toEqual({
      provider: { name: "kept" },
      events: [{ code: "ok" }, { code: "ok2" }],
    });
  });

  it("never throws on null/scalars", () => {
    expect(p5b5StripForbiddenFields(null)).toBeNull();
    expect(p5b5StripForbiddenFields("x")).toBe("x");
    expect(p5b5StripForbiddenFields(5)).toBe(5);
  });
});

describe("p5-batch5 phase 3 — exclusion vocab", () => {
  it("TEST_OR_INVALID is in the excluded-outcome list", () => {
    expect(P5B5_MEMORY_EXCLUDED_OUTCOMES).toContain("TEST_OR_INVALID");
  });

  it("draft AI / drafts / unresolved disputes are in the forbidden source list", () => {
    for (const k of [
      "draft_ai_suggestions",
      "draft_cases",
      "incomplete_pois",
      "unresolved_disputes",
      "rejected_documents_not_relied_on",
      "raw_bank_details",
      "credentials",
      "api_keys",
      "webhook_secrets",
      "tokens",
      "private_notes",
      "support_notes",
    ]) {
      expect(P5B5_MEMORY_FORBIDDEN_SOURCES as readonly string[]).toContain(k);
    }
  });

  it("permitted sources include the nine approved classes", () => {
    expect(P5B5_MEMORY_PERMITTED_SOURCES.length).toBe(9);
    expect(P5B5_MEMORY_PERMITTED_SOURCES).toContain("final_finality_non_test");
    expect(P5B5_MEMORY_PERMITTED_SOURCES).toContain("repeated_pattern_after_threshold");
  });

  it("forbidden-field constant list covers raw bank, credentials, tokens, secrets, PII, drafts", () => {
    for (const k of [
      "iban",
      "account_number",
      "raw_payload",
      "api_key",
      "api_secret",
      "access_token",
      "webhook_secret",
      "password",
      "private_notes",
      "ai_draft",
      "email",
      "phone",
    ]) {
      expect(P5B5_FORBIDDEN_FIELDS).toContain(k);
    }
  });
});

describe("p5-batch5 phase 3 — repeated-pattern threshold", () => {
  it("requires either 2 finality-backed events or 1 compliance-approved material event", () => {
    expect(P5B5_REPEATED_PATTERN_RULE.min_finality_backed_events).toBe(2);
    expect(P5B5_REPEATED_PATTERN_RULE.min_compliance_approved_material_events).toBe(1);
  });
});

describe("p5-batch5 phase 3 — DB writer source guarantees", () => {
  const sql = latestPhase3Migration();

  it("declares writer, stripper and detector functions", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b5_write_memory_from_finality/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b5_strip_forbidden_fields/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b5_detect_repeated_pattern/);
  });

  it("writer is idempotent on finality_record_id", () => {
    expect(sql).toMatch(/WHERE finality_record_id = p_finality_record_id/);
    expect(sql).toMatch(/p5b5\.memory_write_skipped_idempotent/);
  });

  it("writer excludes non-final, TEST_OR_INVALID, and pauses under_dispute", () => {
    expect(sql).toMatch(/p5b5_finality_status IS DISTINCT FROM 'final'/);
    expect(sql).toMatch(/'TEST_OR_INVALID'/);
    expect(sql).toMatch(/p5b5_dispute_status = 'under_dispute'/);
    expect(sql).toMatch(/'paused'/);
  });

  it("writer emits audit events on every path", () => {
    expect(sql).toMatch(/p5b5\.memory_write_excluded/);
    expect(sql).toMatch(/p5b5\.memory_written/);
    expect(sql).toMatch(/p5b5\.memory_paused/);
  });

  it("writer tags FAILED_PROVIDER_DEPENDENCY as provider/process history, not counterparty fault", () => {
    expect(sql).toMatch(/'FAILED_PROVIDER_DEPENDENCY'/);
    expect(sql).toMatch(/is_provider_process_event/);
    expect(sql).toMatch(/is_counterparty_fault/);
    expect(sql).toMatch(/provider_process_history_only/);
  });

  it("writer feeds snapshots through the forbidden-field stripper", () => {
    const stripUses = sql.match(/p5b5_strip_forbidden_fields\(/g) ?? [];
    // helper definition (recursive call x2) + writer call sites = several occurrences
    expect(stripUses.length).toBeGreaterThanOrEqual(5);
  });

  it("writer is SECURITY DEFINER and only service_role may execute it", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.p5b5_write_memory_from_finality\(uuid, uuid, text\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.p5b5_write_memory_from_finality\(uuid, uuid, text\) TO service_role/,
    );
    // not granted to authenticated
    const grants = sql.match(
      /GRANT EXECUTE ON FUNCTION public\.p5b5_write_memory_from_finality[^;]*;/g,
    );
    expect(grants?.some((g) => /authenticated/.test(g))).not.toBe(true);
  });

  it("repeated-pattern detector enforces the documented threshold", () => {
    expect(sql).toMatch(/v_finality_count\s*>=\s*2/);
    expect(sql).toMatch(/v_material_count\s*>=\s*1/);
  });

  it("migration adds no cron jobs and no scheduled sweeps", () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/pg_cron/i);
    expect(sql).not.toMatch(/CREATE\s+EXTENSION/i);
  });
});
