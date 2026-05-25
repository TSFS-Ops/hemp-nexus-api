/**
 * Batch D — governance-waivers helper tests (pure logic + fake admin client).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertWaiverActive,
  clampExpiry,
  consumeGovernanceWaiver,
  grantGovernanceWaiver,
  renewGovernanceWaiver,
  WAIVER_MAX_DAYS,
  WAIVER_MAX_MS,
} from "./governance-waivers.ts";

// ── Pure-logic test for clampExpiry ─────────────────────────────────────────
Deno.test("clampExpiry: defaults to now+7 days when missing", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const out = clampExpiry(null, now);
  assertEquals(out, new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("clampExpiry: caps proposals beyond 7 days", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const tenDays = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  const out = clampExpiry(tenDays, now);
  assertEquals(out, new Date(now + WAIVER_MAX_MS).toISOString());
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

Deno.test("WAIVER_MAX_DAYS is 7", () => assertEquals(WAIVER_MAX_DAYS, 7));

// ── Fake admin client to exercise grant/assert/consume flows ───────────────
function makeFakeAdmin() {
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
