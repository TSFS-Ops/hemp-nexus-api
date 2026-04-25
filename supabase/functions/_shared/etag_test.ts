// Unit tests for the ETag / If-None-Match helpers used by
// GET /wad/:wadId/attestation-ui (and any future read-heavy endpoint that
// adopts the same conditional-GET pattern).
//
// Run: deno test supabase/functions/_shared/etag_test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeETag,
  ifNoneMatchMatches,
  notModifiedResponse,
  sha256Hex,
} from "./etag.ts";

// ─────────────────────── sha256Hex ───────────────────────

Deno.test("sha256Hex returns a 64-char lower-case hex digest", async () => {
  const hex = await sha256Hex("hello");
  assertEquals(hex.length, 64);
  assertEquals(hex, hex.toLowerCase());
  assertEquals(hex, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

// ─────────────────────── computeETag ─────────────────────

Deno.test("computeETag wraps the digest in double quotes", async () => {
  const etag = await computeETag({ a: 1 });
  assert(etag.startsWith('"'), "ETag should start with a quote");
  assert(etag.endsWith('"'), "ETag should end with a quote");
  // 64 hex chars + 2 quotes
  assertEquals(etag.length, 66);
});

Deno.test("computeETag is deterministic for the same payload", async () => {
  const a = await computeETag({ wad_id: "x", status: "draft", n: 1 });
  const b = await computeETag({ wad_id: "x", status: "draft", n: 1 });
  assertEquals(a, b);
});

Deno.test("computeETag changes when payload changes", async () => {
  const a = await computeETag({ status: "draft" });
  const b = await computeETag({ status: "awaiting_attestations" });
  assertNotEquals(a, b);
});

Deno.test("computeETag is sensitive to viewer-specific timestamps", async () => {
  // Regression guard: the attestation-ui payload is per-viewer, so a
  // change to viewerAttestedAt MUST invalidate the cached ETag.
  const a = await computeETag({ ui: { viewerAttestedAt: null } });
  const b = await computeETag({ ui: { viewerAttestedAt: "2025-01-01T00:00:00.000Z" } });
  assertNotEquals(a, b);
});

// ─────────────────────── ifNoneMatchMatches ──────────────

Deno.test("ifNoneMatchMatches returns false when header missing", () => {
  assertEquals(ifNoneMatchMatches(null, '"abc"'), false);
  assertEquals(ifNoneMatchMatches("", '"abc"'), false);
});

Deno.test("ifNoneMatchMatches matches an exact strong validator", () => {
  assertEquals(ifNoneMatchMatches('"abc"', '"abc"'), true);
});

Deno.test("ifNoneMatchMatches does NOT match different etags", () => {
  assertEquals(ifNoneMatchMatches('"abc"', '"def"'), false);
});

Deno.test("ifNoneMatchMatches accepts the wildcard *", () => {
  assertEquals(ifNoneMatchMatches("*", '"anything"'), true);
});

Deno.test("ifNoneMatchMatches accepts the weak prefix W/", () => {
  assertEquals(ifNoneMatchMatches('W/"abc"', '"abc"'), true);
});

Deno.test("ifNoneMatchMatches handles list form with multiple tokens", () => {
  assertEquals(ifNoneMatchMatches('"old", "abc", "older"', '"abc"'), true);
  assertEquals(ifNoneMatchMatches('"x", "y"', '"abc"'), false);
});

Deno.test("ifNoneMatchMatches tolerates surrounding whitespace", () => {
  assertEquals(ifNoneMatchMatches('   "abc"   ', '"abc"'), true);
  assertEquals(ifNoneMatchMatches('"a" ,  "abc"  ,"b"', '"abc"'), true);
});

// ─────────────────────── notModifiedResponse ─────────────

Deno.test("notModifiedResponse is a 304 with no body and the ETag header", async () => {
  const res = notModifiedResponse('"abc"');
  assertEquals(res.status, 304);
  assertEquals(res.headers.get("ETag"), '"abc"');
  // 304 must not include a payload
  const body = await res.text();
  assertEquals(body, "");
});

Deno.test("notModifiedResponse merges extra headers (CORS, Cache-Control)", () => {
  const res = notModifiedResponse('"abc"', {
    "Access-Control-Allow-Origin": "https://example.com",
    "Cache-Control": "private, max-age=10",
  });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://example.com");
  assertEquals(res.headers.get("Cache-Control"), "private, max-age=10");
  assertEquals(res.headers.get("ETag"), '"abc"');
});

Deno.test("notModifiedResponse ETag overrides any caller-supplied ETag", () => {
  // Defensive: if a caller accidentally passes an old ETag in extraHeaders,
  // the freshly computed validator must win so clients don't loop on a
  // stale value.
  const res = notModifiedResponse('"new"', { ETag: '"old"' });
  assertEquals(res.headers.get("ETag"), '"new"');
});

// ─────────────────────── End-to-end style ────────────────

Deno.test("conditional GET round-trip: client echoes ETag and gets 304", async () => {
  const payload = { wad_id: "w-1", status: "draft", ui: { canAttest: true } };
  const etag = await computeETag(payload);

  // First request: no validator → would serve a 200 with the etag
  assertEquals(ifNoneMatchMatches(null, etag), false);

  // Second request: client sends the etag back → server returns 304
  assertEquals(ifNoneMatchMatches(etag, etag), true);

  // Mutated payload (e.g. counterparty just attested) → new etag, no 304
  const payload2 = { ...payload, ui: { canAttest: false } };
  const etag2 = await computeETag(payload2);
  assertNotEquals(etag, etag2);
  assertEquals(ifNoneMatchMatches(etag, etag2), false);
});
