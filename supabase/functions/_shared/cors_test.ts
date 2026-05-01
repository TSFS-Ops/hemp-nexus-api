// Stage 1 CORS helper hardening tests.
//
// Run with: deno test supabase/functions/_shared/cors_test.ts --allow-env
//
// These tests verify that the helper:
//  - falls back to the production allow-list when ALLOWED_ORIGINS is empty
//    (never silently regresses to '*');
//  - echoes a recognised production origin;
//  - rejects unknown origins on preflight;
//  - allows Lovable preview hosts even when not in the explicit list;
//  - only emits '*' when ALLOWED_ORIGINS is literally '*'.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PRODUCTION_ORIGINS,
  corsHeaders,
  handleCors,
  handleCorsPreflight,
  isOriginAllowed,
  resolveAllowedOrigins,
  webhookCorsHeaders,
  withCors,
} from "./cors.ts";

const PROD_ORIGIN = "https://www.izenzo.co.za";
const PROD_APEX = "https://izenzo.co.za";
const PROD_API = "https://api.trade.izenzo.co.za";
const EVIL = "https://evil.example.com";
const PREVIEW = "https://abc-123.lovableproject.com";

function preflight(origin: string | null): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request("https://x.test/anything", { method: "OPTIONS", headers });
}

Deno.test("resolveAllowedOrigins: empty/undefined → production fallback (never '*')", () => {
  for (const v of ["", "   ", undefined, null]) {
    const list = resolveAllowedOrigins(v as string | null | undefined);
    assertEquals(list, [...PRODUCTION_ORIGINS]);
    assertFalse(list.includes("*"), "fallback must never include wildcard");
  }
});

Deno.test("resolveAllowedOrigins: explicit '*' returns wildcard", () => {
  assertEquals(resolveAllowedOrigins("*"), ["*"]);
});

Deno.test("resolveAllowedOrigins: comma list parsed and trimmed", () => {
  assertEquals(
    resolveAllowedOrigins("https://a.test, https://b.test ,https://c.test"),
    ["https://a.test", "https://b.test", "https://c.test"],
  );
});

Deno.test("isOriginAllowed: production origins allowed under empty env", () => {
  assert(isOriginAllowed("", PROD_ORIGIN));
  assert(isOriginAllowed("", PROD_APEX));
  assert(isOriginAllowed("", PROD_API));
});

Deno.test("isOriginAllowed: unknown origin rejected under empty env", () => {
  assertFalse(isOriginAllowed("", EVIL));
});

Deno.test("isOriginAllowed: Lovable preview always allowed", () => {
  assert(isOriginAllowed("", PREVIEW));
  assert(isOriginAllowed("https://only-prod.test", PREVIEW));
});

Deno.test("isOriginAllowed: wildcard env permits anything", () => {
  assert(isOriginAllowed("*", EVIL));
  assert(isOriginAllowed("*", null));
});

Deno.test("corsHeaders: empty env echoes production origin verbatim", () => {
  const h = corsHeaders("", PROD_ORIGIN);
  assertEquals(h["Access-Control-Allow-Origin"], PROD_ORIGIN);
  assertEquals(h["Vary"], "Origin");
});

Deno.test("corsHeaders: empty env + unknown origin returns first prod origin (no echo)", () => {
  const h = corsHeaders("", EVIL);
  assertEquals(h["Access-Control-Allow-Origin"], PRODUCTION_ORIGINS[0]);
});

Deno.test("corsHeaders: only emits '*' when explicitly configured", () => {
  assertEquals(corsHeaders("*", EVIL)["Access-Control-Allow-Origin"], "*");
  assertFalse(corsHeaders("", EVIL)["Access-Control-Allow-Origin"] === "*");
  assertFalse(corsHeaders(PROD_ORIGIN, EVIL)["Access-Control-Allow-Origin"] === "*");
});

Deno.test("handleCors: preflight from prod origin → 204 with echoed origin", () => {
  const res = handleCors(preflight(PROD_ORIGIN), "");
  assert(res, "expected a Response for OPTIONS");
  assertEquals(res!.status, 204);
  assertEquals(res!.headers.get("Access-Control-Allow-Origin"), PROD_ORIGIN);
});

Deno.test("handleCors: preflight from disallowed origin → 403", () => {
  const res = handleCors(preflight(EVIL), "");
  assert(res);
  assertEquals(res!.status, 403);
  assertEquals(res!.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("handleCors: preflight from preview origin → 204 echoed", () => {
  const res = handleCors(preflight(PREVIEW), "");
  assert(res);
  assertEquals(res!.status, 204);
  assertEquals(res!.headers.get("Access-Control-Allow-Origin"), PREVIEW);
});

Deno.test("handleCors: non-OPTIONS request returns null (caller continues)", () => {
  const req = new Request("https://x.test", { method: "GET" });
  assertEquals(handleCors(req, ""), null);
});

Deno.test("handleCorsPreflight: reads env, falls back to production", () => {
  const prevent = Deno.env.get("ALLOWED_ORIGINS");
  try {
    Deno.env.delete("ALLOWED_ORIGINS");
    const ok = handleCorsPreflight(preflight(PROD_ORIGIN));
    assert(ok);
    assertEquals(ok!.status, 204);

    const bad = handleCorsPreflight(preflight(EVIL));
    assert(bad);
    assertEquals(bad!.status, 403);
  } finally {
    if (prevent !== undefined) Deno.env.set("ALLOWED_ORIGINS", prevent);
  }
});

Deno.test("withCors: attaches CORS headers to an existing Response", async () => {
  const prevent = Deno.env.get("ALLOWED_ORIGINS");
  try {
    Deno.env.delete("ALLOWED_ORIGINS");
    const req = new Request("https://x.test", {
      method: "POST",
      headers: { origin: PROD_ORIGIN },
    });
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const wrapped = withCors(req, original);
    assertEquals(wrapped.status, 200);
    assertEquals(wrapped.headers.get("Content-Type"), "application/json");
    assertEquals(wrapped.headers.get("Access-Control-Allow-Origin"), PROD_ORIGIN);
    assertEquals(wrapped.headers.get("Vary"), "Origin");
    // Body must still be readable (must consume to avoid Deno resource leak warning)
    const body = await wrapped.text();
    assertEquals(body, '{"ok":true}');
  } finally {
    if (prevent !== undefined) Deno.env.set("ALLOWED_ORIGINS", prevent);
  }
});

Deno.test("withCors: disallowed origin gets first prod origin (no echo)", async () => {
  const req = new Request("https://x.test", {
    method: "POST",
    headers: { origin: EVIL },
  });
  const wrapped = withCors(req, new Response("hi", { status: 200 }));
  assertEquals(wrapped.headers.get("Access-Control-Allow-Origin"), PRODUCTION_ORIGINS[0]);
  await wrapped.text();
});

Deno.test("webhookCorsHeaders: emits no Allow-Origin", () => {
  const h = webhookCorsHeaders();
  assertEquals(h["Access-Control-Allow-Origin"], undefined);
  assertEquals(h["Vary"], "Origin");
});
