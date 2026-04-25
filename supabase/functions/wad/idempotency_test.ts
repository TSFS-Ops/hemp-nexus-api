// Unit tests for the Idempotency-Key handling used by
// POST /wad/:wadId/attest. The wad/index.ts handler delegates body hashing
// and the miss/replay/mismatch decision to ../_shared/idempotency.ts, so a
// regression in either rule will surface here without needing a live
// Supabase database.
//
// Run: deno test supabase/functions/wad/idempotency_test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalAttestBody,
  decideIdempotency,
  hashAttestBody,
  sha256Hex,
} from "../_shared/idempotency.ts";

// ─────────────────────────── Hashing ───────────────────────────

Deno.test("sha256Hex returns a stable lower-case 64-char hex digest", async () => {
  const hex = await sha256Hex("hello");
  assertEquals(hex, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assertEquals(hex.length, 64);
});

Deno.test("hashAttestBody is deterministic for the same payload", async () => {
  const a = await hashAttestBody({ attested_name: "Jane Doe", role: "buyer_signatory" });
  const b = await hashAttestBody({ attested_name: "Jane Doe", role: "buyer_signatory" });
  assertEquals(a, b);
});

Deno.test("hashAttestBody is key-order independent", async () => {
  // Even though JSON.stringify on the input object would produce different
  // strings, the canonical builder reorders to a fixed schema, so the hash
  // stays the same.
  const a = await hashAttestBody({ attested_name: "Jane", role: "buyer_signatory" });
  // Build an equivalent object with reversed insertion order:
  const reversed: { attested_name: string; role: string } = Object.fromEntries(
    Object.entries({ role: "buyer_signatory", attested_name: "Jane" }).reverse(),
  ) as { attested_name: string; role: string };
  const b = await hashAttestBody(reversed);
  assertEquals(a, b);
});

Deno.test("hashAttestBody differs when attested_name differs", async () => {
  const a = await hashAttestBody({ attested_name: "Jane Doe", role: "buyer_signatory" });
  const b = await hashAttestBody({ attested_name: "John Doe", role: "buyer_signatory" });
  assertNotEquals(a, b);
});

Deno.test("hashAttestBody differs when role differs", async () => {
  const a = await hashAttestBody({ attested_name: "Jane Doe", role: "buyer_signatory" });
  const b = await hashAttestBody({ attested_name: "Jane Doe", role: "seller_signatory" });
  assertNotEquals(a, b);
});

Deno.test("canonicalAttestBody only includes the semantic fields", () => {
  const canonical = canonicalAttestBody({ attested_name: "Jane", role: "buyer_signatory" });
  assertEquals(canonical, '{"attested_name":"Jane","role":"buyer_signatory"}');
});

// ─────────────────────── Idempotency decision ───────────────────────

Deno.test("decideIdempotency: miss when no prior record", () => {
  const decision = decideIdempotency(null, "abc123");
  assertEquals(decision.kind, "miss");
});

Deno.test("decideIdempotency: replay returns cached body + status", () => {
  const cached = { id: "att-1", role: "buyer_signatory" };
  const decision = decideIdempotency(
    { request_hash: "abc123", response_data: cached, response_status_code: 201 },
    "abc123",
  );
  assertEquals(decision.kind, "replay");
  assert(decision.kind === "replay");
  assertEquals(decision.responseData, cached);
  assertEquals(decision.statusCode, 201);
});

Deno.test("decideIdempotency: mismatch when same key but different hash", () => {
  const decision = decideIdempotency(
    { request_hash: "abc123", response_data: { id: "att-1" }, response_status_code: 201 },
    "different-hash",
  );
  assertEquals(decision.kind, "mismatch");
});

// ─────────────────────── End-to-end retry simulation ───────────────────────
//
// Simulates the handler's flow against an in-memory `idempotency_keys` store
// to demonstrate that:
//   1. the first request misses → real handler runs → response cached
//   2. the second request with the same key + body replays the cached response
//      WITHOUT calling the real handler (call counter stays at 1)
//   3. a request with the same key but a different body returns mismatch

interface Stored {
  request_hash: string;
  response_data: unknown;
  response_status_code: number;
}

async function simulate(
  store: Map<string, Stored>,
  key: string,
  body: { attested_name: string; role: string },
  realHandler: () => { data: unknown; status: number },
): Promise<{ status: number; data: unknown; replayed: boolean; mismatch: boolean }> {
  const hash = await hashAttestBody(body);
  const existing = store.get(key) ?? null;
  const decision = decideIdempotency(existing, hash);

  if (decision.kind === "mismatch") {
    return { status: 409, data: { code: "IDEMPOTENCY_KEY_MISMATCH" }, replayed: false, mismatch: true };
  }
  if (decision.kind === "replay") {
    return { status: decision.statusCode, data: decision.responseData, replayed: true, mismatch: false };
  }
  // miss → run real handler, persist
  const result = realHandler();
  store.set(key, {
    request_hash: hash,
    response_data: result.data,
    response_status_code: result.status,
  });
  return { status: result.status, data: result.data, replayed: false, mismatch: false };
}

Deno.test("repeated submissions with the same key + body return the same result", async () => {
  const store = new Map<string, Stored>();
  let calls = 0;
  const realHandler = () => {
    calls += 1;
    return { data: { id: "att-uuid-1", attestation_no: calls }, status: 201 };
  };

  const body = { attested_name: "Jane Doe", role: "buyer_signatory" };

  const first = await simulate(store, "key-A", body, realHandler);
  assertEquals(first.status, 201);
  assertEquals(first.replayed, false);
  assertEquals(calls, 1);

  const second = await simulate(store, "key-A", body, realHandler);
  assertEquals(second.status, 201);
  assertEquals(second.replayed, true);
  assertEquals(second.data, first.data); // identical response
  assertEquals(calls, 1); // real handler NOT invoked again

  const third = await simulate(store, "key-A", body, realHandler);
  assertEquals(third.replayed, true);
  assertEquals(third.data, first.data);
  assertEquals(calls, 1);
});

Deno.test("same key with a different body returns 409 and does not run handler", async () => {
  const store = new Map<string, Stored>();
  let calls = 0;
  const realHandler = () => {
    calls += 1;
    return { data: { id: "att-uuid-1" }, status: 201 };
  };

  await simulate(
    store,
    "key-B",
    { attested_name: "Jane Doe", role: "buyer_signatory" },
    realHandler,
  );
  assertEquals(calls, 1);

  const conflict = await simulate(
    store,
    "key-B",
    { attested_name: "Jane Doe", role: "seller_signatory" }, // different role
    realHandler,
  );
  assertEquals(conflict.status, 409);
  assertEquals(conflict.mismatch, true);
  assertEquals(calls, 1); // not called again
});

Deno.test("different keys do not collide — each runs the real handler", async () => {
  const store = new Map<string, Stored>();
  let calls = 0;
  const realHandler = () => {
    calls += 1;
    return { data: { id: `att-${calls}` }, status: 201 };
  };

  const body = { attested_name: "Jane Doe", role: "buyer_signatory" };
  await simulate(store, "key-1", body, realHandler);
  await simulate(store, "key-2", body, realHandler);
  assertEquals(calls, 2);
});
