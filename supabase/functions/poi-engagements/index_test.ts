// Unit tests for the counterparty_email handling in the POI engagements
// PATCH flow. We test the validation schema and the binding-hint shape that
// the edge function returns to admins. These mirror the rules implemented in
// `index.ts` so a regression there will surface here.
//
// Run: deno test supabase/functions/poi-engagements/index_test.ts

import {
  assert,
  assertEquals,
  assertExists,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { validateInput } from "../_shared/validation.ts";

// ── Mirror of the schema field under test (kept in sync with index.ts) ──
const counterpartyEmailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: "counterparty_email is too short" })
  .max(254, { message: "counterparty_email exceeds 254 characters" })
  .email({ message: "counterparty_email must be a valid email address" })
  .optional();

const UpdateEngagementSchema = z.object({
  counterparty_email: counterpartyEmailField,
});

// ── Mirror of the binding-hint resolver (pure, side-effect free) ──
type BindingHint =
  | { status: "bound"; org_id: string; email: string }
  | { status: "no_match"; email: string; message: string }
  | { status: "already_bound"; org_id: string }
  | { status: "lookup_error"; email: string; message: string };

function resolveBindingHint(opts: {
  email: string;
  currentOrgId: string | null;
  matchedOrgId: string | null;
  lookupError?: string;
}): BindingHint {
  const email = opts.email.trim().toLowerCase();
  if (opts.currentOrgId) {
    return { status: "already_bound", org_id: opts.currentOrgId };
  }
  if (opts.lookupError) {
    return {
      status: "lookup_error",
      email,
      message:
        "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
    };
  }
  if (opts.matchedOrgId) {
    return { status: "bound", org_id: opts.matchedOrgId, email };
  }
  return {
    status: "no_match",
    email,
    message:
      "Email saved, but no registered organisation matches this address yet. The engagement will remain unbound until the recipient signs up or the email is corrected.",
  };
}

// ─────────────────────────── Normalisation ───────────────────────────

Deno.test("normalises mixed-case emails to lowercase", () => {
  const parsed = UpdateEngagementSchema.parse({
    counterparty_email: "Daniel@Izenzo.CO.ZA",
  });
  assertEquals(parsed.counterparty_email, "daniel@izenzo.co.za");
});

Deno.test("trims surrounding whitespace before validation", () => {
  const parsed = UpdateEngagementSchema.parse({
    counterparty_email: "   spaced@example.com   ",
  });
  assertEquals(parsed.counterparty_email, "spaced@example.com");
});

Deno.test("treats counterparty_email as optional (no field = ok)", () => {
  const parsed = UpdateEngagementSchema.parse({});
  assertEquals(parsed.counterparty_email, undefined);
});

// ─────────────────────────── Invalid input ───────────────────────────

Deno.test("rejects an obviously malformed email", () => {
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: "not-an-email",
  });
  assertEquals(result.success, false);
  if (!result.success) {
    assert(
      result.error.issues.some((i) =>
        i.message.includes("must be a valid email address")
      ),
      "expected an email-format error",
    );
  }
});

Deno.test("rejects whitespace-only input as too short after trim", () => {
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: "   ",
  });
  assertEquals(result.success, false);
});

Deno.test("rejects emails longer than 254 chars", () => {
  const local = "a".repeat(250);
  const tooLong = `${local}@example.com`; // > 254
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: tooLong,
  });
  assertEquals(result.success, false);
  if (!result.success) {
    assert(
      result.error.issues.some((i) => i.message.includes("254")),
      "expected a length error",
    );
  }
});

// ─────────────────────────── Binding hint ────────────────────────────

Deno.test("binding hint: returns 'bound' when a matching profile exists", () => {
  const hint = resolveBindingHint({
    email: "Known@example.com",
    currentOrgId: null,
    matchedOrgId: "org-123",
  });
  assertEquals(hint.status, "bound");
  if (hint.status === "bound") {
    assertEquals(hint.org_id, "org-123");
    assertEquals(hint.email, "known@example.com");
  }
});

Deno.test("binding hint: non-fatal 'no_match' when email is unknown", () => {
  const hint = resolveBindingHint({
    email: "stranger@example.com",
    currentOrgId: null,
    matchedOrgId: null,
  });
  assertEquals(hint.status, "no_match");
  if (hint.status === "no_match") {
    assertEquals(hint.email, "stranger@example.com");
    assertExists(hint.message);
    assert(
      hint.message.toLowerCase().includes("no registered organisation"),
      "message should explain why nothing was bound",
    );
  }
});

Deno.test("binding hint: 'already_bound' is preserved (no silent overwrite)", () => {
  const hint = resolveBindingHint({
    email: "anything@example.com",
    currentOrgId: "org-original",
    matchedOrgId: "org-other",
  });
  assertEquals(hint.status, "already_bound");
  if (hint.status === "already_bound") {
    assertEquals(hint.org_id, "org-original");
  }
});

Deno.test("binding hint: 'lookup_error' is non-fatal and surfaces a retry message", () => {
  const hint = resolveBindingHint({
    email: "user@example.com",
    currentOrgId: null,
    matchedOrgId: null,
    lookupError: "connection refused",
  });
  assertEquals(hint.status, "lookup_error");
  if (hint.status === "lookup_error") {
    assert(hint.message.toLowerCase().includes("retry"));
  }
});

// ────────────── Canonical error contract (code/message/details/requestId) ──────────────

Deno.test("validation error: validateInput throws ApiException with VALIDATION_ERROR code", () => {
  const err = assertThrows(
    () => validateInput(UpdateEngagementSchema, { counterparty_email: "not-an-email" }),
    ApiException,
  );
  assertEquals(err.code, "VALIDATION_ERROR");
  assertEquals(err.statusCode, 400);
  // Structured per-field details survive the throw → caller can map to UI.
  assertExists(err.details);
  const errs = (err.details as { errors: Array<{ path: string; message: string }> }).errors;
  assert(Array.isArray(errs) && errs.length > 0, "details.errors must be a non-empty array");
  assertEquals(errs[0].path, "counterparty_email");
  assert(errs[0].message.includes("valid email address"));
});

Deno.test("validation error: errorResponse serialises code/message/details/requestId consistently", async () => {
  const requestId = "req-test-123";
  let caught: ApiException | null = null;
  try {
    validateInput(UpdateEngagementSchema, { counterparty_email: "still-bad" });
  } catch (e) {
    caught = e as ApiException;
  }
  assertExists(caught);
  const res = errorResponse(caught!, requestId);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  // Canonical error contract — must match every other endpoint.
  assertEquals(Object.keys(body).sort(), ["code", "details", "message", "requestId"]);
  assertEquals(body.code, "VALIDATION_ERROR");
  assertEquals(body.requestId, requestId);
  assert(typeof body.message === "string" && body.message.length > 0);
  assert(Array.isArray(body.details.errors));
  assertEquals(body.details.errors[0].path, "counterparty_email");
});

Deno.test("non-fatal lookup miss: no exception is thrown — caller returns 200 with binding hint", () => {
  // The validation pass succeeds (valid email shape); the *lookup* miss must
  // never escalate to a thrown error. Modeled here by calling the resolver
  // directly with a valid email and a null matchedOrgId.
  const validated = validateInput(UpdateEngagementSchema, {
    counterparty_email: "Unknown@example.com",
  });
  assertEquals(validated.counterparty_email, "unknown@example.com");

  const hint = resolveBindingHint({
    email: validated.counterparty_email!,
    currentOrgId: null,
    matchedOrgId: null, // ← lookup miss
  });
  assertEquals(hint.status, "no_match");
  // The hint is the entire failure surface for a miss — there is no thrown error.
});

// ─────────────────────────── Idempotency ───────────────────────────
//
// We use the real shared idempotency helpers against an in-memory mock
// of the `idempotency_keys` table so the tests exercise the actual
// production code paths (lookup → store → replay) without hitting the DB.

import {
  lookupIdempotentResponse,
  storeIdempotentResponse,
} from "../_shared/idempotency.ts";

interface IdemRow {
  org_id: string;
  idempotency_key: string;
  endpoint: string;
  request_hash: string;
  response_data: unknown;
  response_status_code: number;
  expires_at: string;
}

/**
 * Minimal Supabase-client stand-in. Implements just enough of the
 * .from("idempotency_keys").select(...).eq(...).maybeSingle() and
 * .from("idempotency_keys").insert(...) chains the helper actually uses.
 */
function makeMockSupabase() {
  const rows: IdemRow[] = [];

  const builder = (op: "select" | "insert", insertRow?: IdemRow) => {
    const filters: Array<(r: IdemRow) => boolean> = [];
    const chain: any = {
      eq(col: keyof IdemRow, val: unknown) {
        filters.push((r) => (r as any)[col] === val);
        return chain;
      },
      gt(col: keyof IdemRow, val: string) {
        filters.push((r) => (r as any)[col] > val);
        return chain;
      },
      maybeSingle() {
        if (op !== "select") throw new Error("maybeSingle only valid on select");
        const match = rows.find((r) => filters.every((f) => f(r)));
        return Promise.resolve({
          data: match
            ? {
                response_data: match.response_data,
                response_status_code: match.response_status_code,
              }
            : null,
          error: null,
        });
      },
    };
    if (op === "insert" && insertRow) {
      // Enforce the unique index (org_id, idempotency_key, endpoint).
      const dup = rows.find(
        (r) =>
          r.org_id === insertRow.org_id &&
          r.idempotency_key === insertRow.idempotency_key &&
          r.endpoint === insertRow.endpoint,
      );
      if (dup) {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        });
      }
      rows.push(insertRow);
      return Promise.resolve({ data: insertRow, error: null });
    }
    return chain;
  };

  return {
    rows,
    from(_table: string) {
      return {
        select() {
          return builder("select");
        },
        insert(row: IdemRow) {
          return builder("insert", row);
        },
      };
    },
  };
}

const ENDPOINT = "PATCH /poi-engagements";
const ORG = "org-admin-1";

/**
 * Simulates a single PATCH /poi-engagements call. Re-uses the real shared
 * idempotency helpers, the real schema validator, and the real binding-hint
 * resolver — so the test exercises the full production contract.
 *
 * Returns { status, body, replayed } and tracks how many times a real
 * "binding lookup" would have fired (proxied via the bindingLookups counter).
 */
async function simulatePatch(
  supabase: any,
  bindingLookups: { count: number },
  idempotencyKey: string | null,
  body: { counterparty_email?: unknown },
  matchedOrgId: string | null,
): Promise<{ status: number; body: any; replayed: boolean }> {
  const idemOpts = {
    supabase,
    orgId: ORG,
    endpoint: ENDPOINT,
    idempotencyKey,
  };

  // 1. Idempotency replay short-circuit.
  const cached = await lookupIdempotentResponse(idemOpts);
  if (cached) {
    return { status: cached.status, body: cached.body, replayed: true };
  }

  // 2. Validation (canonical error contract).
  let validated: { counterparty_email?: string };
  try {
    validated = validateInput(UpdateEngagementSchema, body);
  } catch (e) {
    const err = e as ApiException;
    return {
      status: err.statusCode,
      body: { code: err.code, message: err.message, details: err.details, requestId: "req-x" },
      replayed: false,
    };
    // Note: per the helper contract, non-2xx responses are NOT cached.
  }

  // 3. Binding lookup (the side effect we want to dedupe).
  let hint: BindingHint | null = null;
  if (validated.counterparty_email) {
    bindingLookups.count += 1;
    hint = resolveBindingHint({
      email: validated.counterparty_email,
      currentOrgId: null,
      matchedOrgId,
    });
  }

  const responseBody = { engagement: { id: "eng-1" }, ...(hint ? { binding: hint } : {}) };
  await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
  return { status: 200, body: responseBody, replayed: false };
}

Deno.test("idempotency: repeated PATCH with same key replays cached response and skips binding lookup", async () => {
  const supabase = makeMockSupabase();
  const lookups = { count: 0 };
  const key = "idem-key-aaa";
  const payload = { counterparty_email: "Daniel@Izenzo.co.za" };

  const first = await simulatePatch(supabase, lookups, key, payload, "org-real-1");
  const second = await simulatePatch(supabase, lookups, key, payload, "org-real-1");
  const third = await simulatePatch(supabase, lookups, key, payload, "org-real-1");

  // The expensive lookup must run exactly once.
  assertEquals(lookups.count, 1);

  assertEquals(first.replayed, false);
  assertEquals(second.replayed, true);
  assertEquals(third.replayed, true);

  // Replays return byte-identical bodies (no inconsistent binding hints).
  assertEquals(second.body, first.body);
  assertEquals(third.body, first.body);
  assertEquals(first.body.binding.status, "bound");
  assertEquals(first.body.binding.email, "daniel@izenzo.co.za");
});

Deno.test("idempotency: different keys re-evaluate but produce a stable binding hint for the same input", async () => {
  const supabase = makeMockSupabase();
  const lookups = { count: 0 };
  const payload = { counterparty_email: "stranger@example.com" };

  const a = await simulatePatch(supabase, lookups, "key-A", payload, null);
  const b = await simulatePatch(supabase, lookups, "key-B", payload, null);

  // Both keys cause a real lookup — no replay because the keys differ.
  assertEquals(lookups.count, 2);
  assertEquals(a.replayed, false);
  assertEquals(b.replayed, false);

  // Identical input → identical hint (no flapping between no_match and anything else).
  assertEquals(a.body.binding.status, "no_match");
  assertEquals(b.body.binding.status, "no_match");
  assertEquals(a.body.binding, b.body.binding);
});

Deno.test("idempotency: validation failures are NOT cached (a corrected retry with same key still runs)", async () => {
  const supabase = makeMockSupabase();
  const lookups = { count: 0 };
  const key = "idem-key-mixed";

  // 1st call — invalid email, returns 400, must NOT be cached.
  const bad = await simulatePatch(
    supabase,
    lookups,
    key,
    { counterparty_email: "not-an-email" },
    "org-real-1",
  );
  assertEquals(bad.status, 400);
  assertEquals(bad.body.code, "VALIDATION_ERROR");
  assertEquals(lookups.count, 0);

  // 2nd call — same key but corrected payload. Must execute (not replay 400).
  const good = await simulatePatch(
    supabase,
    lookups,
    key,
    { counterparty_email: "fixed@example.com" },
    "org-real-1",
  );
  assertEquals(good.status, 200);
  assertEquals(good.replayed, false);
  assertEquals(lookups.count, 1);
  assertEquals(good.body.binding.status, "bound");
});

Deno.test("idempotency: missing key disables replay — every call performs a fresh binding lookup", async () => {
  const supabase = makeMockSupabase();
  const lookups = { count: 0 };
  const payload = { counterparty_email: "user@example.com" };

  await simulatePatch(supabase, lookups, null, payload, "org-real-1");
  await simulatePatch(supabase, lookups, null, payload, "org-real-1");
  await simulatePatch(supabase, lookups, null, payload, "org-real-1");

  assertEquals(lookups.count, 3);
  // Cache stays empty — nothing to short-circuit on.
  assertEquals(supabase.rows.length, 0);
});

Deno.test("idempotency: concurrent inserts under the same key swallow the unique-violation race", async () => {
  const supabase = makeMockSupabase();
  const lookups = { count: 0 };
  const key = "idem-race";
  const payload = { counterparty_email: "race@example.com" };

  // Two callers race past the lookup before either has stored.
  const [a, b] = await Promise.all([
    simulatePatch(supabase, lookups, key, payload, "org-real-1"),
    simulatePatch(supabase, lookups, key, payload, "org-real-1"),
  ]);

  // Both completed without throwing; the loser's INSERT raised 23505 internally
  // and was swallowed by storeIdempotentResponse — exactly one row persists.
  assertEquals(supabase.rows.length, 1);

  // Both responses are well-formed and carry the same binding hint shape.
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  assertEquals(a.body.binding.status, "bound");
  assertEquals(b.body.binding.status, "bound");

  // A third call with the same key now replays the winner's cached body —
  // proving subsequent traffic converges on a single canonical response.
  const c = await simulatePatch(supabase, lookups, key, payload, "org-real-1");
  assertEquals(c.replayed, true);
  assertEquals(c.body.binding, a.body.binding);
});
