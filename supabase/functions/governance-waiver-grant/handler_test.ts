/**
 * Batch D — governance-waiver-grant handler validation tests.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseWaiverBody } from "./handler.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const MATCH = "00000000-0000-0000-0000-000000000002";
const PRIOR = "00000000-0000-0000-0000-000000000003";

Deno.test("grant: minimal valid body parses", () => {
  const r = parseWaiverBody({
    mode: "grant",
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "client_instruction",
  });
  assert(r.ok);
});

Deno.test("grant: missing anchor rejected", () => {
  const r = parseWaiverBody({
    mode: "grant",
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    reason_code: "client_instruction",
  });
  assert(!r.ok);
  assertEquals(r.code, "INVALID_BODY");
});

Deno.test("grant: reason 'other' needs note >= 16 chars", () => {
  const tooShort = parseWaiverBody({
    mode: "grant",
    posture: "bypass",
    scope: "wad",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "other",
    note: "too short",
  });
  assert(!tooShort.ok);
  const ok = parseWaiverBody({
    mode: "grant",
    posture: "bypass",
    scope: "wad",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "other",
    note: "this is a sufficiently long note explaining the binding decision",
  });
  assert(ok.ok);
});

Deno.test("grant: unknown reason_code rejected", () => {
  const r = parseWaiverBody({
    mode: "grant",
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "not_a_code",
  });
  assert(!r.ok);
});

Deno.test("grant: invalid posture rejected", () => {
  const r = parseWaiverBody({
    mode: "grant",
    posture: "wat",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "client_instruction",
  });
  assert(!r.ok);
});

Deno.test("grant: max_uses bounded 1..10", () => {
  const tooMany = parseWaiverBody({
    mode: "grant",
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "client_instruction",
    max_uses: 99,
  });
  assert(!tooMany.ok);
  const zero = parseWaiverBody({
    mode: "grant",
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
    reason_code: "client_instruction",
    max_uses: 0,
  });
  assert(!zero.ok);
});

Deno.test("renew: requires prior_waiver_id", () => {
  const bad = parseWaiverBody({
    mode: "renew",
    reason_code: "waiver_renewed",
  });
  assert(!bad.ok);
  const ok = parseWaiverBody({
    mode: "renew",
    prior_waiver_id: PRIOR,
    reason_code: "waiver_renewed",
  });
  assert(ok.ok);
});

Deno.test("renew: rejects anchor fields (strict)", () => {
  const r = parseWaiverBody({
    mode: "renew",
    prior_waiver_id: PRIOR,
    reason_code: "waiver_renewed",
    match_id: MATCH, // not allowed on renew
  });
  assert(!r.ok);
});
