/**
 * Unit tests for the admin-engagement-delivery-status raw→mapped status
 * mapping. Covers every status the UI relies on (queued / sent / failed /
 * dlq / bounced / complained / suppressed) plus the unlinked fallback for
 * unknown raw values. NO email behaviour is exercised — this is a pure
 * mapping helper.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapStatus } from "../_shared/admin-delivery-status.ts";

Deno.test("mapStatus: pending -> queued", () => {
  assertEquals(mapStatus("pending"), "queued");
  assertEquals(mapStatus("PENDING"), "queued");
});

Deno.test("mapStatus: sent stays sent", () => {
  assertEquals(mapStatus("sent"), "sent");
});

Deno.test("mapStatus: failure-class statuses are passed through", () => {
  assertEquals(mapStatus("failed"), "failed");
  assertEquals(mapStatus("dlq"), "dlq");
  assertEquals(mapStatus("bounced"), "bounced");
  assertEquals(mapStatus("complained"), "complained");
});

Deno.test("mapStatus: suppressed stays suppressed", () => {
  assertEquals(mapStatus("suppressed"), "suppressed");
});

Deno.test("mapStatus: null/undefined/empty -> not_linked", () => {
  assertEquals(mapStatus(null), "not_linked");
  assertEquals(mapStatus(undefined), "not_linked");
  assertEquals(mapStatus(""), "not_linked");
});

Deno.test("mapStatus: unknown provider state -> not_linked (never 'sent')", () => {
  // Critical: unknown raw statuses must NOT degrade to a green/sent badge.
  assertEquals(mapStatus("delivered-maybe"), "not_linked");
  assertEquals(mapStatus("queued_at_provider"), "not_linked");
});
