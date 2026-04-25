// Integration tests for the certificate-rendering endpoints exposed by the
// `wad` and `deal-certificate` edge functions. These tests hit the live
// deployed endpoints over HTTP and validate two contracts that have broken
// for users in production:
//
//   1. CORS — every response (including errors and preflights) must echo
//      Access-Control-Allow-Origin for whitelisted Lovable preview hosts and
//      include the standard Allow-Headers / Allow-Methods set. Missing CORS
//      on error responses is what the browser surfaces as the misleading
//      "Failed to fetch" message.
//
//   2. Response shape — successful WaD certificate downloads must return a
//      real PDF (Content-Type: application/pdf, body starts with "%PDF-").
//      Successful deal certificate downloads must return text/html. Error
//      responses must return JSON with an explicit error code.
//
// The error-path assertions (no auth, missing resource) run unconditionally.
// The success-path assertions require an existing sealed WaD owned by a
// signed-in test user and are skipped with a clear message when the
// WAD_TEST_USER_EMAIL / WAD_TEST_USER_PASSWORD / WAD_TEST_WAD_ID environment
// variables are not present. This keeps the suite green in CI without
// shared credentials while still catching the CORS regressions that
// originally motivated the test.
//
// Run: deno test supabase/functions/wad/certificate_integration_test.ts

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env",
  );
}

// A canonical Lovable preview origin. The CORS layer matches this against the
// LOVABLE_PREVIEW_PATTERNS regex in _shared/cors.ts and echoes it back.
const PREVIEW_ORIGIN = "https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app";

const WAD_BASE = `${SUPABASE_URL}/functions/v1/wad`;
const DEAL_CERT_BASE = `${SUPABASE_URL}/functions/v1/deal-certificate`;

// Optional credentials for the success path — only set in environments that
// have a stable demo account.
const TEST_EMAIL = Deno.env.get("WAD_TEST_USER_EMAIL");
const TEST_PASSWORD = Deno.env.get("WAD_TEST_USER_PASSWORD");
const TEST_WAD_ID = Deno.env.get("WAD_TEST_WAD_ID");
const TEST_MATCH_ID = Deno.env.get("DEAL_CERT_TEST_MATCH_ID");

async function getAccessToken(): Promise<string | null> {
  if (!TEST_EMAIL || !TEST_PASSWORD) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.warn(`[skip] auth failed for ${TEST_EMAIL}: ${JSON.stringify(json)}`);
    return null;
  }
  return json.access_token as string;
}

// ─────────────────────────── Helpers ───────────────────────────

function assertCorsHeaders(
  res: Response,
  { expectEcho = true }: { expectEcho?: boolean } = {},
) {
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assert(
    allowOrigin !== null,
    `Missing Access-Control-Allow-Origin on ${res.status} response`,
  );
  if (expectEcho) {
    assertEquals(
      allowOrigin,
      PREVIEW_ORIGIN,
      `Expected origin echo for whitelisted Lovable preview host (got "${allowOrigin}")`,
    );
  }
  // The shared CORS layer always advertises these headers so the browser will
  // accept subsequent real requests.
  const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
  assertStringIncludes(allowHeaders.toLowerCase(), "authorization");
  assertStringIncludes(allowHeaders.toLowerCase(), "content-type");
  const allowMethods = res.headers.get("access-control-allow-methods") ?? "";
  assertStringIncludes(allowMethods.toUpperCase(), "GET");
  assertStringIncludes(allowMethods.toUpperCase(), "OPTIONS");
}

// ─────────────────────────── CORS preflight ───────────────────────────

Deno.test("OPTIONS /wad/:id/certificate returns 204 with CORS echo", async () => {
  const res = await fetch(`${WAD_BASE}/00000000-0000-0000-0000-000000000000/certificate`, {
    method: "OPTIONS",
    headers: {
      "origin": PREVIEW_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization, content-type",
    },
  });
  await res.body?.cancel(); // 204 has no body, but be explicit
  assertEquals(res.status, 204);
  assertCorsHeaders(res);
});

Deno.test("OPTIONS /deal-certificate/:id returns 204 with CORS echo", async () => {
  const res = await fetch(`${DEAL_CERT_BASE}/00000000-0000-0000-0000-000000000000`, {
    method: "OPTIONS",
    headers: {
      "origin": PREVIEW_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization, content-type",
    },
  });
  await res.body?.cancel();
  assertEquals(res.status, 204);
  assertCorsHeaders(res);
});

Deno.test("OPTIONS /wad/:id/certificate rejects non-whitelisted origin without leaking allow-origin", async () => {
  const res = await fetch(`${WAD_BASE}/00000000-0000-0000-0000-000000000000/certificate`, {
    method: "OPTIONS",
    headers: {
      "origin": "https://evil.example.com",
      "access-control-request-method": "GET",
    },
  });
  await res.body?.cancel();
  assertEquals(res.status, 403);
  // Must not echo the attacker's origin
  assertEquals(res.headers.get("access-control-allow-origin"), null);
});

// ─────────────────────────── Unauthenticated GET ───────────────────────────
//
// These are the regression tests for the original client report. Before the
// fix, error responses omitted CORS headers and the browser surfaced the
// failure as "Failed to fetch" instead of the actual error code.

Deno.test("GET /wad/:id/certificate without auth returns JSON error WITH CORS", async () => {
  const res = await fetch(`${WAD_BASE}/00000000-0000-0000-0000-000000000000/certificate`, {
    method: "GET",
    headers: { "origin": PREVIEW_ORIGIN },
  });
  const body = await res.text();

  // The shared auth layer rejects with 401 (no/invalid token)
  assert(
    res.status === 401 || res.status === 403,
    `Expected 401/403 for unauthenticated request, got ${res.status} body=${body}`,
  );
  assertCorsHeaders(res);
  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "application/json",
    "Error responses must return JSON, not HTML/PDF",
  );
  // Body should be a valid JSON error envelope
  const parsed = JSON.parse(body);
  assert(typeof parsed.error === "string" || typeof parsed.code === "string",
    `Error body should expose an error/code field, got ${body}`);
});

Deno.test("GET /deal-certificate/:id without auth returns JSON error WITH CORS", async () => {
  const res = await fetch(`${DEAL_CERT_BASE}/00000000-0000-0000-0000-000000000000`, {
    method: "GET",
    headers: { "origin": PREVIEW_ORIGIN },
  });
  const body = await res.text();

  assert(
    res.status === 401 || res.status === 403,
    `Expected 401/403 for unauthenticated request, got ${res.status} body=${body}`,
  );
  assertCorsHeaders(res);
  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "application/json",
    "Error responses must return JSON, not HTML/PDF",
  );
  const parsed = JSON.parse(body);
  assert(typeof parsed.error === "string" || typeof parsed.code === "string",
    `Error body should expose an error/code field, got ${body}`);
});

// ─────────────────────────── Authenticated 403/404 path ───────────────────────────
//
// With a valid anon-tier token but a non-existent / non-owned WaD, the
// function must still return a CORS-bearing JSON error.

Deno.test("GET /wad/:id/certificate with auth on missing WaD returns CORS-bearing error", async () => {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.log("[skip] no WAD_TEST_USER_EMAIL/PASSWORD set — skipping authenticated 404 test");
    return;
  }

  const res = await fetch(`${WAD_BASE}/00000000-0000-0000-0000-000000000000/certificate`, {
    method: "GET",
    headers: {
      "origin": PREVIEW_ORIGIN,
      "authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY!,
    },
  });
  const body = await res.text();

  // Could be 403 (RLS) or 404 (not found) — both are valid; key invariant is
  // that the response carries CORS so the browser can read the body.
  assert(
    res.status === 403 || res.status === 404 || res.status === 400,
    `Expected 4xx for missing WaD, got ${res.status} body=${body}`,
  );
  assertCorsHeaders(res);
  assertStringIncludes(res.headers.get("content-type") ?? "", "application/json");
});

// ─────────────────────────── Success path ───────────────────────────
//
// Requires the caller to provide credentials AND a WaD ID they actually own.
// Without these the test is skipped — we cannot fabricate a sealed WaD in a
// test run because sealing is gated on multi-party attestations.

Deno.test("GET /wad/:id/certificate with owner auth returns valid PDF + CORS", async () => {
  const accessToken = await getAccessToken();
  if (!accessToken || !TEST_WAD_ID) {
    console.log(
      "[skip] success-path PDF test requires WAD_TEST_USER_EMAIL, " +
      "WAD_TEST_USER_PASSWORD, and WAD_TEST_WAD_ID env vars",
    );
    return;
  }

  const res = await fetch(`${WAD_BASE}/${TEST_WAD_ID}/certificate`, {
    method: "GET",
    headers: {
      "origin": PREVIEW_ORIGIN,
      "authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY!,
    },
  });

  // CORS must be present even before we look at the body.
  assertCorsHeaders(res);

  if (res.status !== 200) {
    const errBody = await res.text();
    throw new Error(
      `Expected 200 for owner WaD download, got ${res.status}: ${errBody}`,
    );
  }

  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "application/pdf",
    "Successful WaD certificate must be served as application/pdf",
  );

  const bytes = new Uint8Array(await res.arrayBuffer());
  assert(bytes.byteLength > 1000, `PDF suspiciously small: ${bytes.byteLength} bytes`);

  // PDF magic bytes: 0x25 0x50 0x44 0x46 0x2D ("%PDF-")
  const magic = new TextDecoder().decode(bytes.subarray(0, 5));
  assertEquals(magic, "%PDF-", `Body does not start with PDF magic bytes (got "${magic}")`);

  // PDFs end with %%EOF (often followed by a newline). Search the tail.
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.byteLength - 32)));
  assertStringIncludes(tail, "%%EOF", "PDF must terminate with %%EOF marker");
});

Deno.test("GET /deal-certificate/:id with owner auth returns valid HTML + CORS", async () => {
  const accessToken = await getAccessToken();
  if (!accessToken || !TEST_MATCH_ID) {
    console.log(
      "[skip] success-path HTML test requires WAD_TEST_USER_EMAIL, " +
      "WAD_TEST_USER_PASSWORD, and DEAL_CERT_TEST_MATCH_ID env vars",
    );
    return;
  }

  const res = await fetch(`${DEAL_CERT_BASE}/${TEST_MATCH_ID}`, {
    method: "GET",
    headers: {
      "origin": PREVIEW_ORIGIN,
      "authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY!,
    },
  });

  assertCorsHeaders(res);

  if (res.status !== 200) {
    const errBody = await res.text();
    throw new Error(
      `Expected 200 for owner deal certificate, got ${res.status}: ${errBody}`,
    );
  }

  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "text/html",
    "Deal certificate is rendered as HTML, not PDF",
  );

  const html = await res.text();
  assert(html.length > 500, `HTML suspiciously small: ${html.length} bytes`);
  assertStringIncludes(html, "<html", "Body must contain an <html tag");
  assertStringIncludes(html.toLowerCase(), "certificate", "Body should reference 'certificate'");
});
