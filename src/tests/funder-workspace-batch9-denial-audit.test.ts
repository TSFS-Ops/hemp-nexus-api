/**
* Institutional Funder Evidence Workspace — Batch 9
* Static guard: denied-access audit trail.
*
* Asserts the migration adds a narrow, additive logging RPC that
* reuses the existing p5_batch3_funder_audit_events table (no new
* table), that it is authenticated-only, and that both the
* funder-pack-download edge function and funder-client.ts call it on
* denial / not-found paths without altering their existing opaque,
* fail-closed responses.
*/
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

function loadBatch9Sql(): string {
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
const found = bodies.find((b) =>
/CREATE OR REPLACE FUNCTION public\.fw_log_access_event_v1/.test(b),
);
if (!found) throw new Error("Funder Workspace Batch 9 migration not found");
return found;
}

const SQL = loadBatch9Sql();
const DL_FN = readFileSync(
join(ROOT, "supabase/functions/funder-pack-download/index.ts"),
"utf8",
);
const FUNDER_CLIENT = readFileSync(
join(ROOT, "src/lib/funder-workspace/funder-client.ts"),
"utf8",
);

describe("Funder Workspace Batch 9 — denial-audit logging RPC", () => {
it("reuses the existing audit table; introduces no new table", () => {
expect(SQL).not.toMatch(/CREATE TABLE/);
expect(SQL).toMatch(/INSERT INTO public\.p5_batch3_funder_audit_events/);
});

it("requires authentication and validates its result enum", () => {
expect(SQL).toMatch(/auth\.uid\(\) IS NULL/);
expect(SQL).toMatch(/p_result NOT IN \('denied','not_found','error'\)/);
});

it("locks down EXECUTE to authenticated + service_role only", () => {
expect(SQL).toMatch(
/REVOKE EXECUTE ON FUNCTION public\.fw_log_access_event_v1\([^)]*\) FROM PUBLIC, anon/,
);
expect(SQL).toMatch(
/GRANT EXECUTE ON FUNCTION public\.fw_log_access_event_v1\([^)]*\) TO authenticated, service_role/,
);
});

it("does not alter any existing RPC signature (additive only)", () => {
expect(SQL).not.toMatch(/DROP FUNCTION/);
expect(SQL).not.toMatch(/ALTER FUNCTION/);
});
});

describe("Funder Workspace Batch 9 — admin review of repeated attempts", () => {
it("gates the summary RPC on platform_admin", () => {
const idx = SQL.indexOf("fw_admin_access_denial_summary_v1(");
expect(idx).toBeGreaterThan(-1);
const block = SQL.slice(idx, idx + 1500);
expect(block).toMatch(/p5b3_is_platform_admin/);
});

it("only aggregates denied/not_found rows from the access-log source channel", () => {
expect(SQL).toMatch(/source_channel = 'fw_access_log_v1'/);
expect(SQL).toMatch(/new_state ->> 'result' IN \('denied','not_found'\)/);
});
});

describe("Funder Workspace Batch 9 — wiring", () => {
it("funder-pack-download logs a denial before returning its opaque 403", () => {
const authIdx = DL_FN.indexOf("if (authErr)");
const logIdx = DL_FN.indexOf("fw_log_access_event_v1");
const returnIdx = DL_FN.indexOf('"not_available"');
expect(authIdx).toBeGreaterThan(-1);
expect(logIdx).toBeGreaterThan(authIdx);
expect(returnIdx).toBeGreaterThan(logIdx);
});

it("download denial logging never throws into the response path", () => {
const idx = DL_FN.indexOf("fw_log_access_event_v1");
const block = DL_FN.slice(Math.max(0, idx - 200), idx + 200);
expect(block).toMatch(/try\s*\{/);
expect(block).toMatch(/catch/);
});

it("getMyRelease logs a not_found event without changing its null return contract", () => {
expect(FUNDER_CLIENT).toMatch(/fw_log_access_event_v1/);
const idx = FUNDER_CLIENT.indexOf("export async function getMyRelease");
const block = FUNDER_CLIENT.slice(idx, idx + 1200);
expect(block).toMatch(/if \(!row\)/);
expect(block).toMatch(/return row;/);
expect(block).toMatch(/\.catch\(\(\) => \{\}\);/);
});

it("funder-client only adds the one new approved RPC (no other new funder-side RPCs)", () => {
const rpcCalls = [...FUNDER_CLIENT.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]);
const allowed = new Set(["fw_counters_funder_v1", "fw_log_access_event_v1"]);
for (const name of rpcCalls) {
expect(allowed.has(name), `unexpected funder-side RPC ${name}`).toBe(true);
}
});
});
