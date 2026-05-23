/**
 * SEC-001-FU-001 — Deno unit tests for the shared AAL helper.
 *
 * Verifies `readAal` and `assertAal2` behave according to the SEC-001
 * fail-closed contract:
 *   - aal2 JWT → allow
 *   - aal1 JWT → 403 MFA_REQUIRED
 *   - unknown / malformed / missing → 403 MFA_REQUIRED
 *   - denial audit write failure is swallowed (best-effort, non-fatal)
 *
 * Uses local fake JWT strings (header.payload.signature) — no live
 * Supabase or network calls.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { assertAal2, readAal } from "./aal.ts";
import { ApiException } from "./errors.ts";

function b64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  // Signature segment can be any opaque string — readAal does not verify.
  return `${header}.${body}.unverified-signature`;
}

Deno.test("readAal: returns aal2 for JWT carrying aal:'aal2'", () => {
  assertEquals(readAal(fakeJwt({ aal: "aal2", sub: "u1" })), "aal2");
  // `Bearer ` prefix is tolerated.
  assertEquals(readAal("Bearer " + fakeJwt({ aal: "aal2" })), "aal2");
});

Deno.test("readAal: returns aal1 for JWT carrying aal:'aal1'", () => {
  assertEquals(readAal(fakeJwt({ aal: "aal1", sub: "u1" })), "aal1");
});

Deno.test("readAal: returns unknown for missing/null/malformed tokens", () => {
  assertEquals(readAal(null), "unknown");
  assertEquals(readAal(undefined), "unknown");
  assertEquals(readAal(""), "unknown");
  assertEquals(readAal("not-a-jwt"), "unknown");
  assertEquals(readAal("only.one"), "unknown");
  // Valid 3-segment shape but payload missing `aal` claim.
  assertEquals(readAal(fakeJwt({ sub: "u1" })), "unknown");
  // Unrecognised aal value falls back to unknown (fail-closed).
  assertEquals(readAal(fakeJwt({ aal: "aal3" })), "unknown");
});

Deno.test("assertAal2: allows aal2 sessions (no throw)", async () => {
  await assertAal2("Bearer " + fakeJwt({ aal: "aal2", sub: "u1" }));
});

Deno.test("assertAal2: rejects aal1 with 403 MFA_REQUIRED", async () => {
  const err = await assertRejects(
    () => assertAal2("Bearer " + fakeJwt({ aal: "aal1", sub: "u1" })),
    ApiException,
  );
  assertEquals(err.code, "MFA_REQUIRED");
  assertEquals(err.statusCode, 403);
});

Deno.test("assertAal2: rejects unknown/missing token with 403 MFA_REQUIRED (fail-closed)", async () => {
  for (const bad of [null, "", "not-a-jwt", fakeJwt({ sub: "u1" })]) {
    const err = await assertRejects(
      () => assertAal2(bad as string | null),
      ApiException,
    );
    assertEquals(err.code, "MFA_REQUIRED");
    assertEquals(err.statusCode, 403);
  }
});

Deno.test("assertAal2: denial audit write failure is swallowed (best-effort, non-fatal)", async () => {
  // adminClient.from().insert() throws synchronously — assertAal2 must
  // still throw the MFA_REQUIRED ApiException, NOT the audit error.
  const explodingAdmin = {
    from() {
      return {
        insert() {
          throw new Error("simulated audit-write failure");
        },
      };
    },
  };
  const err = await assertRejects(
    () =>
      assertAal2("Bearer " + fakeJwt({ aal: "aal1", sub: "u1" }), {
        adminClient: explodingAdmin,
        callerUserId: "u1",
        action: "admin.test_action",
        context: { extra: "ctx" },
      }),
    ApiException,
  );
  assertEquals(err.code, "MFA_REQUIRED");
  assertEquals(err.statusCode, 403);
});

Deno.test("assertAal2: writes denial audit row when service client is supplied", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const recordingAdmin = {
    from(table: string) {
      assertEquals(table, "admin_audit_logs");
      return {
        // deno-lint-ignore no-explicit-any
        insert(row: any) {
          captured.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  await assertRejects(
    () =>
      assertAal2("Bearer " + fakeJwt({ aal: "aal1", sub: "u1" }), {
        adminClient: recordingAdmin,
        callerUserId: "u1",
        action: "admin.test_action",
      }),
    ApiException,
  );
  assertEquals(captured.length, 1);
  assertEquals(captured[0].action, "admin.mfa_required_denied");
  assert(
    JSON.stringify(captured[0].details).includes("admin.test_action"),
    "audit row should reference attempted action",
  );
});
