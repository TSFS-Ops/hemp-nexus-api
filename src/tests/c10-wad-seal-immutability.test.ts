/**
 * C10 — Sealed WaD metadata immutability static guard.
 *
 * Pins the trigger/function shape, allowlist, protected fields, and the
 * explicit non-changes (no RLS, grant, policy, storage, legal-hold, or
 * cleanup edits) in the C10 migration.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
// Lovable Cloud auto-names migrations with a uuid suffix, so we locate
// the C10 migration by its function name rather than by filename.
const migFile = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .find((f) =>
    readFileSync(resolve(MIG_DIR, f), "utf8").includes(
      "assert_wad_seal_immutability",
    ),
  );

describe("C10 — WaD seal immutability migration", () => {
  it("migration file exists", () => {
    expect(migFile, "expected a migration defining assert_wad_seal_immutability").toBeTruthy();
  });

  const sql = migFile ? readFileSync(resolve(MIG_DIR, migFile), "utf8") : "";

  it("creates the assert_wad_seal_immutability function", () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.assert_wad_seal_immutability\s*\(\s*\)/i);
    expect(sql).toMatch(/LANGUAGE\s+plpgsql/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*(=|TO)\s*'?public'?/i);
  });

  it("creates the wads_seal_immutability_trg BEFORE UPDATE OR DELETE trigger", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+wads_seal_immutability_trg/i);
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.wads/i);
    expect(sql).toMatch(/FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.assert_wad_seal_immutability\s*\(\s*\)/i);
  });

  it("gates enforcement on the sealed_at column", () => {
    // Either polarity is acceptable; the function uses `OLD.sealed_at IS NULL`
    // as the pre-seal early-return guard, which is equivalent.
    expect(sql).toMatch(/OLD\.sealed_at\s+IS\s+(NOT\s+)?NULL/i);
  });

  it("raises sealed_wad_immutable on protected mutation", () => {
    expect(sql).toMatch(/sealed_wad_immutable/);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it("blocks DELETE of sealed rows", () => {
    expect(sql).toMatch(/TG_OP\s*=\s*'DELETE'/i);
  });

  it("uses an allowlist-by-column-diff enforcement model", () => {
    // The function compares OLD vs NEW across every column and rejects
    // any diff outside the allowlist. This is stronger than enumerating
    // protected fields one by one, because new columns added later are
    // protected by default.
    expect(sql).toMatch(/to_jsonb\s*\(\s*OLD\s*\)/i);
    expect(sql).toMatch(/to_jsonb\s*\(\s*NEW\s*\)/i);
    expect(sql).toMatch(/IS\s+DISTINCT\s+FROM/i);
    expect(sql).toMatch(/allowlist/i);
  });

  it("allowlist is narrow and revocation/supersession scoped", () => {
    for (const allowed of [
      "status",
      "revoked_at",
      "revoked_by",
      "revoked_reason",
      "superseded_by_wad_id",
      "certificate_path",
      "certificate_generated_at",
      "updated_at",
    ]) {
      expect(sql, `allowlisted field ${allowed} must appear`).toMatch(
        new RegExp(`'${allowed}'`),
      );
    }
  });

  it("does NOT touch RLS / grants / policies / other tables", () => {
    expect(sql).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bALTER\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bDROP\s+POLICY\b/i);
    // GRANT / REVOKE as SQL statements (not as the noun "revoke" in a comment).
    expect(sql).not.toMatch(/^\s*GRANT\s+/im);
    expect(sql).not.toMatch(/^\s*REVOKE\s+/im);
    expect(sql).not.toMatch(/\bmatch_documents\b/i);
    expect(sql).not.toMatch(/\bstorage\./i);
    expect(sql).not.toMatch(/\blegal_holds?\b/i);
    expect(sql).not.toMatch(/\bstorage_deletion_queue\b/i);
    // Append-only event guards must not be re-defined here.
    expect(sql).not.toMatch(/assert_match_events_append_only/);
    expect(sql).not.toMatch(/assert_poi_events_append_only/);
    expect(sql).not.toMatch(/prevent_event_store_mutation/);
  });


  it("does not backfill or rewrite existing WaD rows", () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.wads\b/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.wads\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.wads\b/i);
  });
});
