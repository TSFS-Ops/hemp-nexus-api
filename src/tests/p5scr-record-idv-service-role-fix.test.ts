/**
 * p5scr_record_idv service-role fix -- static regression guard.
 *
 * Confirms the new migration (added, not editing history) that lets the
 * idv-person-verify / idv-manual-review edge functions record IDV results
 * via a service-role call, without broadening grants or touching any RLS
 * SELECT policy on p5scr_* tables.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260710120000_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";

describe("p5scr_record_idv service-role fix", () => {
    it("ships a new migration and does not edit historical migrations", () => {
          expect(file).toBeTruthy();
          const histFile = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626181548_"));
          expect(histFile).toBeTruthy();
          const historical = readFileSync(resolve(MIG_DIR, histFile!), "utf8");
          expect(historical).toMatch(/IF NOT public\.has_role\(auth\.uid\(\),\s*'platform_admin'\)\s*THEN/);
          expect(historical).not.toMatch(/service_role/);
    });

           it("creates or replaces public.p5scr_record_idv with the same signature", () => {
                 expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.p5scr_record_idv\(/);
                 expect(sql).toMatch(/p_subject_id uuid/);
                 expect(sql).toMatch(/p_raw_provider_payload_admin_only jsonb DEFAULT NULL/);
                 expect(sql).toMatch(/SECURITY DEFINER/);
                 expect(sql).toMatch(/SET\s+search_path\s*=\s*public/);
           });

           it("preserves the platform_admin path", () => {
                 expect(sql).toMatch(/public\.has_role\(auth\.uid\(\),\s*'platform_admin'\)/);
           });

           it("adds the service_role path, combined with OR (not replacing platform_admin)", () => {
                 const ifBlock = /IF NOT \(([\s\S]*?)\)\s*THEN/.exec(sql);
                 expect(ifBlock, "expected a combined IF NOT (...) THEN condition").toBeTruthy();
                 const cond = ifBlock![1];
                 expect(cond).toMatch(/public\.has_role\(auth\.uid\(\),\s*'platform_admin'\)/);
                 expect(cond).toMatch(/auth\.role\(\)\s*=\s*'service_role'/);
                 expect(cond).toMatch(/\bOR\b/);
           });

           it("keeps the original exception message and error code", () => {
                 expect(sql).toMatch(/RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege'/);
           });

           it("keeps EXECUTE limited to authenticated -- no anon, no PUBLIC", () => {
                 expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.p5scr_record_idv\([^)]*\)\s*TO authenticated/);
                 expect(sql).not.toMatch(/TO anon/);
                 expect(sql).not.toMatch(/GRANT[^;]*TO PUBLIC/);
                 expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.p5scr_record_idv\([^)]*\)\s*FROM PUBLIC/);
           });

           it("does not touch any RLS policy", () => {
                 expect(sql).not.toMatch(/CREATE POLICY/);
                 expect(sql).not.toMatch(/ALTER POLICY/);
                 expect(sql).not.toMatch(/DROP POLICY/);
           });

           it("does not create, alter, or drop any table", () => {
                 expect(sql).not.toMatch(/CREATE TABLE/i);
                 expect(sql).not.toMatch(/ALTER TABLE/i);
                 expect(sql).not.toMatch(/DROP TABLE/i);
           });
});
