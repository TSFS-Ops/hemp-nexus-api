/**
* Institutional Funder Evidence Workspace -- Batch 5 (External Adviser)
* Static tests: the download-authorization RPC must reject the
* external_adviser role server-side, and the funder-facing UI must not
* render an enabled download control for that role either.
*/
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

function allMigrations(): string {
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

function latestAuthorizeDownloadFunctionBody(sql: string): string {
const idx = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.fw_funder_authorize_pack_download_v1");
if (idx === -1) throw new Error("fw_funder_authorize_pack_download_v1 not found");
return sql.slice(idx);
}

describe("Batch 5 -- external adviser cannot download compiled packs (server-side)", () => {
const sql = allMigrations();
const body = latestAuthorizeDownloadFunctionBody(sql);

it("checks the caller's per-release V1 role and rejects external_adviser", () => {
expect(body).toMatch(/fw_v1_role_for_release\(v_r\.id\)\s*=\s*'external_adviser'/);
expect(body).toMatch(/external_adviser role is read-only/);
});

it("still enforces the original org-membership, release-state and permission checks", () => {
expect(body).toMatch(/p5b3_current_funder_org/);
expect(body).toMatch(/v_r\.funder_organisation_id\s*<>\s*v_org/);
expect(body).toMatch(/release_status\s*<>\s*'active'/);
expect(body).toMatch(/NOT v_r\.can_download_compiled_pack/);
});

it("does not change the function signature or return shape", () => {
expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_funder_authorize_pack_download_v1\(\s*p_pack_version_id uuid\s*\) RETURNS jsonb/);
expect(body).toMatch(/'pack_version_id', v_pv\.id/);
});

it("EXECUTE remains locked to authenticated and service_role", () => {
expect(body).toContain("REVOKE EXECUTE ON FUNCTION public.fw_funder_authorize_pack_download_v1(uuid) FROM PUBLIC, anon;");
expect(body).toContain("GRANT EXECUTE ON FUNCTION public.fw_funder_authorize_pack_download_v1(uuid) TO authenticated, service_role;");
});
});

describe("Batch 5 -- funder-facing UI does not offer a download control to external advisers", () => {
const src = readFileSync("src/pages/funder/workspace/DealDetail.tsx", "utf8");

it("passes the caller's role into the download button", () => {
expect(src).toMatch(/<FunderPackDownloadButton pack=\{p\} release=\{release\} role=\{v1Role\} \/>/);
});

it("the download button checks for the external_adviser role before offering a download", () => {
const idx = src.indexOf("function FunderPackDownloadButton");
const fn = src.slice(idx, idx + 1500);
expect(fn).toMatch(/role:\s*V1Role \| null/);
expect(fn).toMatch(/role === "external_adviser"/);
expect(fn).toMatch(/Not available/);
});
});
