/**
 * governance-audit-batch-b_test.ts — taxonomy registration tests for the
 * Batch B HQ note + correction event types.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CONTROLLED_TAXONOMY,
  domainFor,
  isCriticalEvent,
} from "./governance-audit.ts";
import {
  HQ_NOTE_POLICY_VERSION,
  POLICY_VERSION_BY_EVENT_TYPE,
} from "./governance-policy-versions.ts";

Deno.test("hq.note_added is in CONTROLLED_TAXONOMY", () => {
  assert(CONTROLLED_TAXONOMY.has("hq.note_added"));
});

Deno.test("hq.event_corrected is in CONTROLLED_TAXONOMY", () => {
  assert(CONTROLLED_TAXONOMY.has("hq.event_corrected"));
});

Deno.test("hq.note_added is critical / fail-closed", () => {
  assertEquals(isCriticalEvent("hq.note_added"), true);
});

Deno.test("hq.event_corrected is critical / fail-closed", () => {
  assertEquals(isCriticalEvent("hq.event_corrected"), true);
});

Deno.test("both HQ note types map to hq-note/v1 policy version", () => {
  assertEquals(POLICY_VERSION_BY_EVENT_TYPE["hq.note_added"], HQ_NOTE_POLICY_VERSION);
  assertEquals(POLICY_VERSION_BY_EVENT_TYPE["hq.event_corrected"], HQ_NOTE_POLICY_VERSION);
  assertEquals(HQ_NOTE_POLICY_VERSION, "hq-note/v1");
});

Deno.test("both HQ note types map to the 'core' domain (hq family)", () => {
  assertEquals(domainFor("hq.note_added"), "core");
  assertEquals(domainFor("hq.event_corrected"), "core");
});

Deno.test("an unregistered hq.* event is NOT in the taxonomy", () => {
  // Guard against silently accepting arbitrary hq.* names.
  assertEquals(CONTROLLED_TAXONOMY.has("hq.something_else"), false);
});
