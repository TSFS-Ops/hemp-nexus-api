/**
 * handler_test.ts — Deno tests for hq-note-add validation + aggregate logic.
 *
 * Pure-function coverage. The Zod body schema, anchor logic, and aggregate
 * derivation. HTTP serve handler (auth, RBAC, AAL2) is exercised separately
 * by integration tests.
 */

import {
  assertEquals,
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveAggregate,
  HQ_NOTE_REASON_CODES,
  MIN_NOTE_LENGTH,
  parseHqNoteBody,
} from "./handler.ts";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";
const UUID_D = "44444444-4444-4444-4444-444444444444";
const UUID_E = "55555555-5555-5555-5555-555555555555";

function validNote(over: Record<string, unknown> = {}) {
  return {
    note_type: "note",
    note: "Operational note recorded for audit.",
    reason_code: "client_instruction",
    org_id: UUID_A,
    match_id: UUID_B,
    ...over,
  };
}

Deno.test("parseHqNoteBody — valid note body passes", () => {
  const r = parseHqNoteBody(validNote());
  assert(r.ok, "expected ok");
});

Deno.test("parseHqNoteBody — note shorter than 8 chars fails", () => {
  const r = parseHqNoteBody(validNote({ note: "short" }));
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.code, "INVALID_BODY");
  }
});

Deno.test("parseHqNoteBody — minimum length boundary is 8", () => {
  const exactly8 = "x".repeat(MIN_NOTE_LENGTH);
  const r = parseHqNoteBody(validNote({ note: exactly8 }));
  assert(r.ok, "8 chars must pass");
});

Deno.test("parseHqNoteBody — correction requires corrects_event_id", () => {
  const r = parseHqNoteBody(validNote({ note_type: "correction" }));
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(JSON.stringify(r.details), "corrects_event_id");
  }
});

Deno.test("parseHqNoteBody — correction with corrects_event_id passes", () => {
  const r = parseHqNoteBody(
    validNote({ note_type: "correction", corrects_event_id: UUID_C }),
  );
  assert(r.ok, "correction with target uuid must pass");
});

Deno.test("parseHqNoteBody — reason_code 'other' needs note >= 16 chars", () => {
  const tooShort = parseHqNoteBody(
    validNote({ reason_code: "other", note: "12345678" /* 8 chars */ }),
  );
  assertEquals(tooShort.ok, false);

  const longEnough = parseHqNoteBody(
    validNote({
      reason_code: "other",
      note: "Specific reason for HQ override action.",
    }),
  );
  assert(longEnough.ok, "16+ char note for 'other' must pass");
});

Deno.test("parseHqNoteBody — invalid reason_code rejected", () => {
  const r = parseHqNoteBody(
    validNote({ reason_code: "not_a_real_code" }),
  );
  assertEquals(r.ok, false);
});

Deno.test("parseHqNoteBody — at least one anchor is required", () => {
  const r = parseHqNoteBody({
    note_type: "note",
    note: "valid length text body",
    reason_code: "client_instruction",
    org_id: UUID_A,
    // no anchors at all
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(JSON.stringify(r.details), "anchor");
  }
});

Deno.test("parseHqNoteBody — correction without anchor is allowed (target is the anchor)", () => {
  const r = parseHqNoteBody({
    note_type: "correction",
    note: "Recorded correction note.",
    reason_code: "incorrect_data_correction",
    org_id: UUID_A,
    corrects_event_id: UUID_C,
  });
  assert(r.ok, "correction with only corrects_event_id must pass");
});

Deno.test("HQ_NOTE_REASON_CODES — exposes the controlled six-code list", () => {
  assertEquals([...HQ_NOTE_REASON_CODES].sort(), [
    "client_instruction",
    "dispute_reviewed",
    "incorrect_data_correction",
    "manual_verification_completed",
    "other",
    "system_recovery",
  ]);
});

Deno.test("deriveAggregate — match_id wins over other anchors", () => {
  const r = deriveAggregate({
    note_type: "note",
    note: "x".repeat(MIN_NOTE_LENGTH),
    reason_code: "client_instruction",
    org_id: UUID_A,
    match_id: UUID_B,
    poi_id: UUID_C,
    wad_id: UUID_D,
    engagement_id: UUID_E,
  } as any);
  assertEquals(r.aggregate_type, "match");
  assertEquals(r.aggregate_id, UUID_B);
});

Deno.test("deriveAggregate — poi_id next when no match_id", () => {
  const r = deriveAggregate({
    note_type: "note",
    note: "x".repeat(MIN_NOTE_LENGTH),
    reason_code: "client_instruction",
    org_id: UUID_A,
    poi_id: UUID_C,
    wad_id: UUID_D,
  } as any);
  assertEquals(r.aggregate_type, "poi");
  assertEquals(r.aggregate_id, UUID_C);
});

Deno.test("deriveAggregate — wad_id, then engagement_id, then payment_reference", () => {
  const wad = deriveAggregate({
    note_type: "note",
    note: "x".repeat(MIN_NOTE_LENGTH),
    reason_code: "client_instruction",
    org_id: UUID_A,
    wad_id: UUID_D,
    engagement_id: UUID_E,
  } as any);
  assertEquals(wad.aggregate_type, "wad");

  const eng = deriveAggregate({
    note_type: "note",
    note: "x".repeat(MIN_NOTE_LENGTH),
    reason_code: "client_instruction",
    org_id: UUID_A,
    engagement_id: UUID_E,
  } as any);
  assertEquals(eng.aggregate_type, "engagement");

  const pay = deriveAggregate({
    note_type: "note",
    note: "x".repeat(MIN_NOTE_LENGTH),
    reason_code: "client_instruction",
    org_id: UUID_A,
    payment_reference: "paystack_ref_1",
  } as any);
  assertEquals(pay.aggregate_type, "payment");
  assertEquals(pay.aggregate_id, "paystack_ref_1");
});

Deno.test("deriveAggregate — correction with no anchor uses corrected event as aggregate", () => {
  const r = deriveAggregate({
    note_type: "correction",
    note: "Correction note text.",
    reason_code: "incorrect_data_correction",
    org_id: UUID_A,
    corrects_event_id: UUID_C,
  } as any);
  assertEquals(r.aggregate_type, "event");
  assertEquals(r.aggregate_id, UUID_C);
});
