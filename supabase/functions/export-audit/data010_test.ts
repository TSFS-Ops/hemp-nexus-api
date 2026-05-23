/**
 * DATA-010 Phase 1 — Deno source-level pins on export-audit/index.ts.
 *
 * These tests do NOT spin up the function; they assert that the
 * source contract required by DATA-010 Phase 1 is present, so the
 * file cannot regress quietly. Runtime behaviour is also covered by
 * src/tests/data-010-*.test.ts on the client side.
 */
import { assert, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const PURPOSE_SHARED = await Deno.readTextFile(
  new URL("../_shared/export-purpose.ts", import.meta.url),
);

Deno.test("DATA-010: BodySchema requires purpose from EXPORT_PURPOSES enum", () => {
  assertMatch(SRC, /purpose:\s*z\.enum\(EXPORT_PURPOSES\)/);
});

Deno.test("DATA-010: BodySchema enforces MIN_EXPORT_REASON_LENGTH on reason", () => {
  assertMatch(SRC, /reason:[\s\S]*?\.min\(MIN_EXPORT_REASON_LENGTH/);
});

Deno.test("DATA-010: BodySchema accepts target_org_id (uuid|null) and data_categories[]", () => {
  assertMatch(SRC, /target_org_id:\s*z\.string\(\)\.uuid\(\)\.nullable\(\)/);
  assertMatch(SRC, /data_categories:\s*z\.array\(/);
});

Deno.test("DATA-010: server-side is_admin gate runs before request body parsing", () => {
  const adminIdx = SRC.indexOf('rpc("is_admin"');
  const parseIdx = SRC.indexOf("BodySchema.safeParse");
  assert(adminIdx > 0, "is_admin RPC call missing");
  assert(parseIdx > 0, "BodySchema.safeParse missing");
  assert(adminIdx < parseIdx, "is_admin must be checked before body parsing");
});

Deno.test("DATA-010: assertAal2 gate uses canonical action key export.admin_pii_export", () => {
  assertMatch(SRC, /assertAal2\(/);
  assertMatch(SRC, /action:\s*"export\.admin_pii_export"/);
});

Deno.test("DATA-010: emits all three canonical audit names", () => {
  assertStringIncludes(SRC, "data.admin_export_requested");
  assertStringIncludes(SRC, "data.admin_export_blocked_or_declined");
  assertStringIncludes(SRC, "data.admin_export_generated");
});

Deno.test("DATA-010: returns 403 MFA_REQUIRED on AAL gate failure", () => {
  assertMatch(SRC, /code:\s*"MFA_REQUIRED"[\s\S]*?aal_required:\s*true/);
});

Deno.test("DATA-010: returns 403 NOT_PLATFORM_ADMIN when caller is not platform_admin", () => {
  assertMatch(SRC, /code:\s*"NOT_PLATFORM_ADMIN"/);
});

Deno.test("DATA-010: shared EXPORT_PURPOSES enum + MIN_EXPORT_REASON_LENGTH are the source of truth", () => {
  assertMatch(PURPOSE_SHARED, /EXPORT_PURPOSES\s*=\s*\[/);
  assertMatch(PURPOSE_SHARED, /MIN_EXPORT_REASON_LENGTH\s*=\s*10/);
});
