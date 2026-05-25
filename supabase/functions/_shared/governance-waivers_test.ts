/**
 * Batch D — governance-waivers pure-logic tests.
 *
 * Full grant/consume/renew flows that drive the canonical writer end-to-end
 * are validated via live-deploy proof and the handler/taxonomy tests; this
 * file covers the deterministic pure logic (expiry clamping + constants).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clampExpiry,
  WAIVER_DEFAULT_MAX_USES,
  WAIVER_MAX_DAYS,
  WAIVER_MAX_MS,
} from "./governance-waivers.ts";

Deno.test("clampExpiry: defaults to now+7 days when missing", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  assertEquals(clampExpiry(null, now), new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("clampExpiry: caps proposals beyond 7 days", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const tenDays = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  assertEquals(clampExpiry(tenDays, now), new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("clampExpiry: honours shorter proposals", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const oneHour = new Date(now + 60 * 60 * 1000).toISOString();
  assertEquals(clampExpiry(oneHour, now), oneHour);
});

Deno.test("clampExpiry: past dates collapse to default cap", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const past = new Date(now - 1000).toISOString();
  assertEquals(clampExpiry(past, now), new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("constants: 1 use / 7 days defaults are binding", () => {
  assertEquals(WAIVER_DEFAULT_MAX_USES, 1);
  assertEquals(WAIVER_MAX_DAYS, 7);
  assert(WAIVER_MAX_MS === 7 * 24 * 60 * 60 * 1000);
});
