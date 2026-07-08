/**
 * Batch V — VerifyNow adapter smoke test (Deno).
 *
 * Runs with a fetch tripwire that fails the test if ANY uninjected
 * network call is attempted. Proves:
 *   - Unsupported country/document routes never reach fetch.
 *   - Missing VERIFYNOW_API_KEY returns PROVIDER_MISCONFIGURED (no fetch).
 *   - Production mode without an Idempotency-Key returns
 *     IDEMPOTENCY_KEY_REQUIRED (no fetch).
 *   - Production mode with the same key but a different payload returns
 *     IDEMPOTENCY_CONFLICT (no fetch).
 *   - The adapter sends `x-api-key` and (production only) an
 *     `Idempotency-Key` header when a fetchImpl is injected.
 *   - Unknown provider body strings map to provider_error, never to
 *     a success state.
 */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyNowIdv, classifyProviderResponse } from "./adapter.ts";

// Fetch tripwire: replace global fetch with one that ALWAYS throws.
// Every call site in the adapter under test must inject fetchImpl.
const originalFetch = globalThis.fetch;
(globalThis as { fetch: typeof fetch }).fetch = ((_url: string, _init?: RequestInit) => {
  throw new Error("TRIPWIRE: global fetch called during smoke test");
}) as typeof fetch;

Deno.test("Batch V — unsupported country never triggers a provider call", async () => {
  const out = await verifyNowIdv({
    route: { document_country: "XX", document_type: "whatever" },
    payload: {},
  }, { apiKey: "test", mode: "sandbox" });
  assertEquals(out.route_resolution.kind, "provider_not_available");
  assertEquals(out.error_code, "PROVIDER_NOT_AVAILABLE");
});

Deno.test("Batch V — placeholder country never triggers a provider call", async () => {
  const out = await verifyNowIdv({
    route: { document_country: "GH", document_type: "national_id_placeholder" },
    payload: {},
  }, { apiKey: "test", mode: "sandbox" });
  assertEquals(out.route_resolution.kind, "provider_not_available");
});

Deno.test("Batch V — missing API key fails closed with PROVIDER_MISCONFIGURED", async () => {
  const out = await verifyNowIdv(
    {
      route: { document_country: "ZA", document_type: "za_home_affairs_enhanced" },
      payload: { said_number: "0000000000000", first_names: "A", surname: "B" },
    },
    { apiKey: undefined, mode: "sandbox" },
  );
  assertEquals(out.error_code, "PROVIDER_MISCONFIGURED");
  assertEquals(out.resolved?.internal_status, "provider_error");
  assertEquals(out.resolved?.unlocks_controlled_actions, false);
  assertEquals(out.resolved?.user_wording, "Manual review required");
});

Deno.test("Batch V — production requires Idempotency-Key (fail-closed)", async () => {
  const out = await verifyNowIdv(
    {
      route: { document_country: "NG", document_type: "ng_nin" },
      payload: { nin: "12345678901", first_name: "A", last_name: "B" },
    },
    { apiKey: "prod", mode: "production" },
  );
  assertEquals(out.error_code, "IDEMPOTENCY_KEY_REQUIRED");
});

Deno.test("Batch V — production idempotency conflict (same key, different payload)", async () => {
  const key = "550e8400-e29b-41d4-a716-446655440000";
  const out = await verifyNowIdv(
    {
      route: { document_country: "NG", document_type: "ng_nin" },
      payload: { nin: "99999999999", first_name: "A", last_name: "B" },
      idempotencyKey: key,
      priorPayloadForKey: { nin: "11111111111", first_name: "A", last_name: "B" },
    },
    { apiKey: "prod", mode: "production" },
  );
  assertEquals(out.error_code, "IDEMPOTENCY_CONFLICT");
});

Deno.test("Batch V — injected fetchImpl sends x-api-key + Idempotency-Key in prod", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch = ((_url: string, init?: RequestInit) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return Promise.resolve(
      new Response(JSON.stringify({ match: "clear", reference: "REF123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  const key = "550e8400-e29b-41d4-a716-446655440000";
  const out = await verifyNowIdv(
    {
      route: { document_country: "ZA", document_type: "za_home_affairs_enhanced" },
      payload: { said_number: "0000000000000", first_names: "A", surname: "B" },
      idempotencyKey: key,
    },
    { apiKey: "prod-key", mode: "production", fetchImpl: fakeFetch },
  );
  assertEquals(capturedHeaders["x-api-key"], "prod-key");
  assertEquals(capturedHeaders["Idempotency-Key"], key);
  assertEquals(out.resolved?.internal_status, "idv_completed");
  assertEquals(out.resolved?.unlocks_controlled_actions, true);
  assertEquals(out.provider_reference, "REF123");
});

Deno.test("Batch V — unknown provider body → provider_error (no false success)", () => {
  assertEquals(classifyProviderResponse(200, { match: "unknown_string" }), "provider_error");
  assertEquals(classifyProviderResponse(200, { status: "weird" }), "provider_error");
  assertEquals(classifyProviderResponse(200, null), "provider_error");
  assertEquals(classifyProviderResponse(500, {}), "source_unavailable");
  assertEquals(classifyProviderResponse(408, {}), "timeout");
  assertEquals(classifyProviderResponse(404, {}), "not_found");
});

Deno.test("Batch V — blocked/deceased/fraud statuses map to blocked_pending_admin_decision", () => {
  assertEquals(classifyProviderResponse(200, { status: "blocked" }), "blocked_id");
  assertEquals(classifyProviderResponse(200, { status: "deceased" }), "deceased");
  assertEquals(classifyProviderResponse(200, { status: "fraud" }), "suspected_fraud");
});

Deno.test("Batch V -- SA said_basic posts to fixed /verify with reportType + mode (contract alignment)", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fakeFetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return Promise.resolve(
                  new Response(JSON.stringify({ match: "clear", reference: "REF-SA-1" }), {
                            status: 200,
                            headers: { "content-type": "application/json" },
                  }),
                );
    }) as typeof fetch;

    await verifyNowIdv(
      {
              route: { document_country: "ZA", document_type: "za_said_basic" },
              payload: { said_number: "8001015009087", surname: "Test" },
      },
      { apiKey: "test", mode: "sandbox", fetchImpl: fakeFetch },
        );

    assert(capturedUrl.endsWith("/verify"));
    assert(!capturedUrl.includes("za_said_basic"));
    assertEquals(capturedBody.reportType, "said_verification");
    assertEquals(capturedBody.idNumber, "8001015009087");
    assertEquals(capturedBody.mode, "sandbox");
});

Deno.test("Batch V -- SA home_affairs_enhanced posts to fixed /verify with home_affairs_id_photo reportType (contract alignment)", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fakeFetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return Promise.resolve(
                  new Response(JSON.stringify({ match: "clear", reference: "REF-SA-2" }), {
                            status: 200,
                            headers: { "content-type": "application/json" },
                  }),
                );
    }) as typeof fetch;

    await verifyNowIdv(
      {
              route: { document_country: "ZA", document_type: "za_home_affairs_enhanced" },
              payload: { said_number: "9111060123086", first_names: "A", surname: "B" },
      },
      { apiKey: "test", mode: "sandbox", fetchImpl: fakeFetch },
        );

    assert(capturedUrl.endsWith("/verify"));
    assert(!capturedUrl.includes("za_home_affairs_enhanced"));
    assertEquals(capturedBody.reportType, "home_affairs_id_photo");
    assertEquals(capturedBody.idNumber, "9111060123086");
    assertEquals(capturedBody.mode, "sandbox");
});

Deno.test("Batch V -- Nigeria NIN posts to /africa-verification with country/id_type constants (contract alignment)", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fakeFetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return Promise.resolve(
                  new Response(JSON.stringify({ match: "clear", reference: "REF-NG-1" }), {
                            status: 200,
                            headers: { "content-type": "application/json" },
                  }),
                );
    }) as typeof fetch;

    await verifyNowIdv(
      {
              route: { document_country: "NG", document_type: "ng_nin" },
              payload: { nin: "12345678901" },
      },
      { apiKey: "test", mode: "sandbox", fetchImpl: fakeFetch },
        );

    assert(capturedUrl.endsWith("/africa-verification"));
    assert(!capturedUrl.includes("ng_nin"));
    assertEquals(capturedBody.country, "NG");
    assertEquals(capturedBody.id_type, "NIN_V2");
    assertEquals(capturedBody.id_number, "12345678901");
    assertEquals(capturedBody.mode, "sandbox");
    assertEquals(capturedBody.reportType, undefined);
});

Deno.test("Batch V -- unconfirmed Nigeria route (ng_bvn) fails closed, never calls fetch", async () => {
    const out = await verifyNowIdv(
      {
              route: { document_country: "NG", document_type: "ng_bvn" },
              payload: { bvn: "12345678901" },
      },
      { apiKey: "test", mode: "sandbox" },
        );
    assertEquals(out.error_code, "PROVIDER_MISCONFIGURED");
});

Deno.test("Batch V -- unconfirmed Nigeria route (ng_virtual_nin) fails closed, never calls fetch", async () => {
    const out = await verifyNowIdv(
      {
              route: { document_country: "NG", document_type: "ng_virtual_nin" },
              payload: { virtual_nin: "12345678901" },
      },
      { apiKey: "test", mode: "sandbox" },
        );
    assertEquals(out.error_code, "PROVIDER_MISCONFIGURED");
});

// Restore fetch — leaves the runtime clean for other test files.
Deno.test({
  name: "Batch V — restore fetch tripwire",
  fn: () => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    assert(true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
