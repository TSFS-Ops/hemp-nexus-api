import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Deliberately references the specific Phase 2 migration filename rather
// than "pick the latest migration" — see PR #26 CI investigation: a
// latest-file heuristic in another test file was found to silently
// re-target itself onto whichever migration happens to sort last,
// which is fragile and unrelated to correctness of any specific change.
const MIGRATION_PATH = join(
    process.cwd(),
    "supabase/migrations/20260719130000_cw_phase2_legacy_compat.sql"
    );

const SQL = readFileSync(MIGRATION_PATH, "utf8");

const EDGE_FN_PATH = join(process.cwd(), "supabase/functions/compliance-cases/index.ts");
const GUARD_PATH = join(process.cwd(), "supabase/functions/_shared/compliance-freshness-guard.ts");
const EDGE_FN_SRC = readFileSync(EDGE_FN_PATH, "utf8");
const GUARD_SRC = readFileSync(GUARD_PATH, "utf8");

describe("cw Phase 2 legacy compatibility migration", () => {
    it("is additive-only and never drops or alters the legacy compliance_cases table/constraint", () => {
        expect(SQL).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public\.compliance_cases/i);
        expect(SQL).not.toMatch(/ALTER\s+TABLE\s+public\.compliance_cases[\s\S]*?DROP\s+CONSTRAINT/i);
        expect(SQL).not.toMatch(/DROP\s+CONSTRAINT[\s\S]*?compliance_cases_status_check/i);
    });

         it("adds decision_notes and decided_by to cw_cases as nullable columns", () => {
             expect(SQL).toMatch(
                 /ALTER TABLE public\.cw_cases ADD COLUMN IF NOT EXISTS decision_notes text;/
                 );
             expect(SQL).toMatch(
                 /ALTER TABLE public\.cw_cases ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL;/
                 );
             expect(SQL).not.toMatch(/decision_notes text NOT NULL/);
             expect(SQL).not.toMatch(/decided_by uuid NOT NULL/);
         });

         it("backfill UPDATE only fills currently-NULL decision_notes/decided_by (idempotent)", () => {
             const updateBlockMatch = SQL.match(
                 /UPDATE public\.cw_cases nc[\s\S]*?lc\.decision_notes IS NOT NULL OR lc\.decided_by IS NOT NULL\);/
                 );
             expect(updateBlockMatch).not.toBeNull();
             const block = updateBlockMatch![0];
             expect(block).toMatch(/nc\.decision_notes IS NULL/);
             expect(block).toMatch(/nc\.decided_by IS NULL/);
         });

         it("links legacy-backfilled cases to their event_store history via cw_case_related_records", () => {
             expect(SQL).toMatch(
                 /INSERT INTO public\.cw_case_related_records \(case_id, record_table, record_id, relationship\)/
                 );
             expect(SQL).toMatch(/es\.aggregate_type = 'compliance_case'/);
             expect(SQL).toMatch(/'legacy_event'/);
             expect(SQL).toMatch(/ON CONFLICT \(case_id, record_table, record_id\) DO NOTHING;/);
         });

         it("installs the sync trigger AFTER INSERT OR UPDATE on compliance_cases (not BEFORE, not INSTEAD OF)", () => {
             expect(SQL).toMatch(
                 /CREATE TRIGGER cw_sync_legacy_compliance_case_trg\s*\nAFTER INSERT OR UPDATE ON public\.compliance_cases/
                 );
             expect(SQL).not.toMatch(/BEFORE INSERT OR UPDATE ON public\.compliance_cases/);
             expect(SQL).not.toMatch(/INSTEAD OF INSERT OR UPDATE ON public\.compliance_cases/);
         });

         it("the trigger function catches all exceptions and never re-raises, protecting the legacy write path", () => {
             const fnMatch = SQL.match(
                 /CREATE OR REPLACE FUNCTION public\.cw_sync_legacy_compliance_case\(\)[\s\S]*?\$\$;/
                 );
             expect(fnMatch).not.toBeNull();
             const fn = fnMatch![0];
             expect(fn).not.toMatch(/RAISE EXCEPTION/);
             expect(fn).toMatch(/RETURN NEW;/);
             const exceptionBlocks = fn.match(/EXCEPTION WHEN OTHERS THEN/g) || [];
             // one handler around the main sync logic, one nested around the
            // exception-logging insert itself, so logging failures can never
            // propagate and break the legacy write either.
            expect(exceptionBlocks.length).toBeGreaterThanOrEqual(2);
         });

         it("logs sync failures to cw_legacy_migration_exceptions instead of raising", () => {
             expect(SQL).toMatch(/INSERT INTO public\.cw_legacy_migration_exceptions \(legacy_case_id, reason, detail\)/);
             expect(SQL).toMatch(/'sync_trigger_exception'/);
         });

         it("does not modify the live compliance-cases Edge Function or the freshness guard source files", () => {
             // The migration's own comments legitimately name these two files to
            // explain what is intentionally left untouched, so a literal
            // string-match against the migration text itself is the wrong check
            // (it produces a false failure). Instead, verify directly against the
            // live source files that Phase 2 did not introduce any dependency on
            // the new cw_cases aggregate or its sync trigger.
            expect(EDGE_FN_SRC).not.toMatch(/cw_cases/);
             expect(EDGE_FN_SRC).not.toMatch(/cw_sync_legacy_compliance_case/);
             expect(GUARD_SRC).not.toMatch(/cw_cases/);
             expect(GUARD_SRC).not.toMatch(/cw_sync_legacy_compliance_case/);
         });
});
