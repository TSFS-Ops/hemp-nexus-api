/**
 * idv-person-verify provider_live_now fix -- static regression guard.
 *
 * idv-person-verify previously called p5scr_record_idv with
 * p_provider_live_now hardcoded to true for every route and every
 * outcome, with no p_activation_signed_off_at ever supplied. That
 * unconditionally violated the p5scr_idv_live_requires_signoff CHECK
 * constraint (provider_live_now = false OR activation_signed_off_at IS
 * NOT NULL), since automated calls never carry a real sign-off.
 *
 * This guard confirms the fix (pass false / omit the key) and that
 * nothing else -- the constraint, RLS, grants, or the route table --
 * was touched to work around it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { IDV_ROUTE_TABLE } from "@/lib/idv/route-table";

function read(rel: string): string {
    return readFileSync(rel, "utf8");
}

const src = read("supabase/functions/idv-person-verify/index.ts");

describe("idv-person-verify -- provider_live_now fix", () => {
    it("no longer passes p_provider_live_now: true to p5scr_record_idv", () => {
          expect(src).not.toMatch(/p_provider_live_now:\s*true/);
    });

           it("passes p_provider_live_now: false, or omits the argument so the RPC default (false) applies", () => {
                 const rpcCallStart = src.indexOf('admin.rpc("p5scr_record_idv"');
                 expect(rpcCallStart).toBeGreaterThan(-1);
                 const rpcCallEnd = src.indexOf("});", rpcCallStart);
                 expect(rpcCallEnd).toBeGreaterThan(-1);
                 const rpcCallBlock = src.slice(rpcCallStart, rpcCallEnd);
                 const hasFalse = /p_provider_live_now:\s*false/.test(rpcCallBlock);
                 const omitsKey = !/p_provider_live_now/.test(rpcCallBlock);
                 expect(hasFalse || omitsKey).toBe(true);
           });

           it("does not set activation_signed_off_at automatically", () => {
                 expect(src).not.toMatch(/p_activation_signed_off_at/);
                 expect(src.includes("signed_off")).toBe(false);
           });
});

describe("idv-person-verify -- no DB/RLS/route-table changes introduced by this fix", () => {
    it("the check constraint is untouched -- still requires a real sign-off for live_now", () => {
          const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
          const histFile = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626181220_"));
          expect(histFile).toBeTruthy();
          const sql = readFileSync(resolve(MIG_DIR, histFile!), "utf8");
          expect(sql).toMatch(/CONSTRAINT p5scr_idv_live_requires_signoff/);
          expect(sql).toMatch(/CHECK \(provider_live_now = false OR \(activation_signed_off_at IS NOT NULL\)\)/);
    });

           it("idv-person-verify contains no DDL of any kind (no table/policy/grant changes)", () => {
                 const upper = src.toUpperCase();
                 for (const kw of [
                         "CREATE TABLE",
                         "ALTER TABLE",
                         "DROP TABLE",
                         "CREATE POLICY",
                         "ALTER POLICY",
                         "DROP POLICY",
                         "GRANT ",
                         "REVOKE ",
                       ]) {
                         expect(upper.includes(kw)).toBe(false);
                 }
           });

           it("p5scr_record_idv itself is not modified by this fix (same call site, same RPC name)", () => {
                 expect(src.includes('admin.rpc("p5scr_record_idv"')).toBe(true);
           });
});

describe("idv-person-verify -- supporting-only routes remain supporting-only", () => {
    it("za_said_basic is still supporting_only and cannot unlock controlled actions", () => {
          const entry = IDV_ROUTE_TABLE.find(
                  (r) => r.document_country === "ZA" && r.document_type === "za_said_basic",
                );
          expect(entry?.document_class).toBe("supporting_only");
          expect(entry?.can_unlock_controlled_actions).toBe(false);
    });

           it("the shared route table file itself was not modified by this fix", () => {
                 const routeSrc = read("supabase/functions/_shared/idv-route-table.ts");
                 expect(routeSrc).toMatch(/document_type:\s*"za_said_basic"/);
                 expect(routeSrc).toMatch(/can_unlock_controlled_actions:\s*false/);
           });
});

describe("idv-person-verify -- manual-review fallback path is unchanged", () => {
    it("still returns PROVIDER_NOT_AVAILABLE (ok:false) without calling VerifyNow for unresolved routes", () => {
          const routeCheckIdx = src.indexOf('routeRes.kind !== "route"');
          const verifyCallIdx = src.indexOf("await verifyNowIdv(");
          expect(routeCheckIdx).toBeGreaterThan(-1);
          expect(verifyCallIdx).toBeGreaterThan(-1);
          expect(routeCheckIdx).toBeLessThan(verifyCallIdx);
          const block = src.slice(routeCheckIdx, verifyCallIdx);
          expect(block.includes('"PROVIDER_NOT_AVAILABLE"')).toBe(true);
    });

           it("still returns RECORD_FAILED (500) if p5scr_record_idv errors, unchanged from before this fix", () => {
                 expect(
                         src.includes('return json({ error: "RECORD_FAILED", detail: rpcErr.message }, 500, req);'),
                       ).toBe(true);
           });
});
