/**
 * DATA-005 Phase 1 — source-level pins for user-export-request/index.ts.
 *
 * These tests do NOT spin up the function. They assert that the file
 * encodes the contract DATA-005 Phase 1 promises, so behaviour cannot
 * regress quietly. Runtime UI behaviour is covered by the Vitest suite
 * under src/tests/data-005-*.test.ts.
 */
import { assert, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const SSOT = await Deno.readTextFile(
  new URL("../_shared/user-export-categories.ts", import.meta.url),
);

Deno.test("DATA-005: POST-only edge function", () => {
  assertMatch(SRC, /method_not_allowed/);
  assertMatch(SRC, /req\.method\s*!==\s*"POST"/);
});

Deno.test("DATA-005: requires Authorization Bearer JWT and rejects unauthenticated", () => {
  assertMatch(SRC, /authHeader\.startsWith\("Bearer "\)/);
  assertStringIncludes(SRC, '"unauthorized"');
});

Deno.test("DATA-005: validates body with Zod (categories required, max length, strict)", () => {
  assertMatch(SRC, /BodySchema[\s\S]*?categories:\s*z\.array/);
  assertMatch(SRC, /\.min\(1\)\.max\(32\)/);
  assertMatch(SRC, /\.strict\(\)/);
});

Deno.test("DATA-005: enforces rate-limit via _shared/rate-limit.ts", () => {
  assertStringIncludes(SRC, '../_shared/rate-limit.ts');
  assertStringIncludes(SRC, "checkRateLimit(");
  // Per-user partition: rate-limit key includes user id.
  assertMatch(SRC, /`user-export-request:\$\{user\.id\}`/);
  // Returns 429 on RATE_LIMIT_EXCEEDED.
  assertMatch(SRC, /code:\s*"RATE_LIMIT_EXCEEDED"/);
});

Deno.test("DATA-005: legal/security hold helper present and future-safe", () => {
  assertStringIncludes(SRC, "checkLegalHold");
  // Future-safe: must NOT throw when legal_holds table is absent.
  assertMatch(SRC, /catch[\s\S]*?blocked:\s*false/);
});

Deno.test("DATA-005: resolves scope via resolveExportScope helper", () => {
  assertStringIncludes(SRC, "resolveExportScope(");
  assertStringIncludes(SRC, "../_shared/user-export-categories.ts");
});

Deno.test("DATA-005: emits all Phase 1 canonical audit names", () => {
  assertStringIncludes(SRC, '"data.user_export_requested"');
  assertStringIncludes(SRC, '"data.user_export_scope_resolved"');
  assertStringIncludes(SRC, '"data.user_export_blocked_or_declined"');
});

Deno.test("DATA-005: does NOT emit Phase 2 audit names outside comments", () => {
  const phase2 = [
    "data.user_export_generated",
    "data.user_export_downloaded",
    "data.user_export_file_destroyed",
  ];
  for (const name of phase2) {
    for (const line of SRC.split("\n")) {
      if (line.includes(`"${name}"`)) {
        const trimmed = line.trim();
        assert(
          trimmed.startsWith("//") || trimmed.startsWith("*"),
          `Phase 2 audit "${name}" must not be emitted in Phase 1 (found: ${line})`,
        );
      }
    }
  }
});

Deno.test("DATA-005: never returns user payload data in response", () => {
  // The function only returns id/status/categories/next_step — never
  // any of the actual user data. Pin by verifying the response keys.
  assertMatch(SRC, /request_id:\s*inserted\.id/);
  assertMatch(SRC, /next_step:/);
  // Negative: there is no profile/match/document payload assembly here.
  const forbidden = ["profile_data", "match_payload", "document_blobs"];
  for (const f of forbidden) assert(!SRC.includes(f), `payload field ${f} leaked`);
});

Deno.test("DATA-005: blocked transition sets block_reason and writes block audit", () => {
  assertMatch(SRC, /status:\s*"blocked"/);
  assertMatch(SRC, /block_reason:\s*hold\.reason/);
});

Deno.test("DATA-005: SSOT exposes the eight allowed categories and the forbidden list", () => {
  const allowed = [
    "profile",
    "org_memberships",
    "notification_prefs",
    "my_trade_requests",
    "my_matches",
    "my_engagements",
    "my_billing_usage",
    "my_documents",
  ];
  for (const c of allowed) assertStringIncludes(SSOT, `"${c}"`);
  const forbidden = [
    "passwords",
    "api_keys",
    "webhook_secrets",
    "auth_tokens",
    "session_tokens",
    "reset_tokens",
    "payment_card_data",
    "admin_notes",
    "privileged_legal_notes",
    "raw_audit_logs",
    "other_users_personal_data",
    "unrelated_org_data",
  ];
  for (const c of forbidden) assertStringIncludes(SSOT, `"${c}"`);
});
