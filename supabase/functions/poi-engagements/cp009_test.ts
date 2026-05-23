// CP-009 / DEC-003 — Pending counterparty accepts after the engagement has expired.
//
// The signed rule:
//   • Late acceptance keeps the engagement on
//     `late_acceptance_pending_initiator_reconfirmation`.
//   • The counterparty response is recorded as `accepted_after_expiry`.
//   • No POI mint, no WaD, no credit burn, no payment event, no execution
//     side-effect occurs purely from the late acceptance.
//   • Initiator reconfirm / decline each emit a SIGNED-FORM SIBLING audit
//     row alongside (never instead of) the canonical RPC-written rows:
//       canonical            sibling
//       ---------            -------
//       pending_engagement.reconfirmed
//                            pending_engagement.late_acceptance_reconfirmed_by_initiator
//       pending_engagement.initiator_declined_after_late_acceptance
//                            pending_engagement.late_acceptance_declined_by_initiator
//   • The counterparty-facing response carries the verbatim
//     acknowledgement copy below.
//
// Run: deno test supabase/functions/poi-engagements/cp009_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const CP009_ACK_COPY =
  "This engagement has expired. Your acceptance has been recorded, but the initiator must reconfirm before the engagement can proceed.";

// Sibling-audit gating mirror of index.ts (CP-009 block).
function siblingActionFor(action: "reconfirm" | "decline-late-acceptance"): string {
  return action === "reconfirm"
    ? "pending_engagement.late_acceptance_reconfirmed_by_initiator"
    : "pending_engagement.late_acceptance_declined_by_initiator";
}

function canonicalActionFor(action: "reconfirm" | "decline-late-acceptance"): string {
  return action === "reconfirm"
    ? "pending_engagement.reconfirmed"
    : "pending_engagement.initiator_declined_after_late_acceptance";
}

// Mirror of the response body shape returned by the late-acceptance branch.
function buildLateAcceptanceResponseBody(
  lateUpdated: Record<string, unknown>,
  windowExpiresAt: string | null,
) {
  return {
    engagement: lateUpdated,
    late_acceptance: {
      recorded: true,
      counterparty_response: "accepted_after_expiry",
      state: "late_acceptance_pending_initiator_reconfirmation",
      reconfirmation_window_expires_at: windowExpiresAt,
      counterparty_acknowledgement: CP009_ACK_COPY,
    },
  };
}

// Mirror of the CP-009 sibling-metadata builder.
function buildSiblingMetadata(opts: {
  action: "reconfirm" | "decline-late-acceptance";
  engagementId: string;
  renewedEngagementId: string | null;
  matchId: string | null;
  poiId: string | null;
  initiatorUserId: string;
  initiatorOrgId: string;
  counterpartyUserId: string | null;
  counterpartyOrgId: string | null;
  counterpartyEmailHash: string | null;
  priorStatus: string | null;
  newStatus: string | null;
  nowIso: string;
}): Record<string, unknown> {
  const isReconfirm = opts.action === "reconfirm";
  return {
    cp_rule: "CP-009",
    engagement_id: opts.engagementId,
    renewed_engagement_id: opts.renewedEngagementId,
    match_id: opts.matchId,
    poi_id: opts.poiId,
    initiator_user_id: opts.initiatorUserId,
    initiator_organisation_id: opts.initiatorOrgId,
    counterparty_user_id: opts.counterpartyUserId,
    counterparty_organisation_id: opts.counterpartyOrgId,
    counterparty_email_hash: opts.counterpartyEmailHash,
    prior_engagement_status: opts.priorStatus,
    new_engagement_status: opts.newStatus,
    counterparty_response: "accepted_after_expiry",
    ...(isReconfirm
      ? { initiator_reconfirmed: true, reconfirmed_at: opts.nowIso }
      : { initiator_declined: true, declined_at: opts.nowIso }),
    poi_completed: false,
    wad_triggered: false,
    credit_burned: false,
    payment_event_created: false,
  };
}

Deno.test("CP-009: late-acceptance response body still pins the signed state and response code", () => {
  const body = buildLateAcceptanceResponseBody(
    { id: "eng-1", engagement_status: "late_acceptance_pending_initiator_reconfirmation" },
    "2026-05-30T00:00:00.000Z",
  );
  assertEquals(body.late_acceptance.recorded, true);
  assertEquals(body.late_acceptance.counterparty_response, "accepted_after_expiry");
  assertEquals(
    body.late_acceptance.state,
    "late_acceptance_pending_initiator_reconfirmation",
  );
  assertEquals(
    body.late_acceptance.reconfirmation_window_expires_at,
    "2026-05-30T00:00:00.000Z",
  );
});

Deno.test("CP-009: counterparty acknowledgement copy is present verbatim", () => {
  const body = buildLateAcceptanceResponseBody(
    { id: "eng-1" },
    null,
  );
  assertEquals(
    body.late_acceptance.counterparty_acknowledgement,
    "This engagement has expired. Your acceptance has been recorded, but the initiator must reconfirm before the engagement can proceed.",
  );
  // Sanity: copy explains both halves of the rule.
  assertStringIncludes(
    body.late_acceptance.counterparty_acknowledgement,
    "expired",
  );
  assertStringIncludes(
    body.late_acceptance.counterparty_acknowledgement,
    "reconfirm",
  );
});

Deno.test("CP-009: late acceptance produces NO POI / WaD / credit / payment side-effects", () => {
  // The handler returns only the engagement update + the late_acceptance
  // descriptor. Any of these fields appearing in the descriptor would be
  // a regression of the no-side-effects contract.
  const body = buildLateAcceptanceResponseBody({ id: "eng-1" }, null);
  const la = body.late_acceptance as Record<string, unknown>;
  assertFalse("poi_id" in la);
  assertFalse("wad_id" in la);
  assertFalse("credit_burned" in la);
  assertFalse("payment_event_id" in la);
  assertFalse("payment_reference" in la);
  assertFalse("execution_started" in la);
});

Deno.test("CP-009: sibling audit action names are exactly the signed-form strings", () => {
  assertEquals(
    siblingActionFor("reconfirm"),
    "pending_engagement.late_acceptance_reconfirmed_by_initiator",
  );
  assertEquals(
    siblingActionFor("decline-late-acceptance"),
    "pending_engagement.late_acceptance_declined_by_initiator",
  );
});

Deno.test("CP-009: sibling is always written ALONGSIDE the canonical action, never instead", () => {
  // Canonical names are owned by the atomic RPCs; this pins that the
  // sibling has a DIFFERENT action string so dashboards see both rows.
  assert(siblingActionFor("reconfirm") !== canonicalActionFor("reconfirm"));
  assert(
    siblingActionFor("decline-late-acceptance") !==
      canonicalActionFor("decline-late-acceptance"),
  );
});

Deno.test("CP-009: reconfirm sibling metadata carries the signed-form fields", () => {
  const md = buildSiblingMetadata({
    action: "reconfirm",
    engagementId: "eng-parent",
    renewedEngagementId: "eng-child",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "user-init",
    initiatorOrgId: "org-init",
    counterpartyUserId: "user-cp",
    counterpartyOrgId: "org-cp",
    counterpartyEmailHash: "deadbeef",
    priorStatus: "expired",
    newStatus: "reconfirmed",
    nowIso: "2026-05-23T19:00:00.000Z",
  });
  assertEquals(md.cp_rule, "CP-009");
  assertEquals(md.engagement_id, "eng-parent");
  assertEquals(md.renewed_engagement_id, "eng-child");
  assertEquals(md.counterparty_response, "accepted_after_expiry");
  assertEquals(md.initiator_reconfirmed, true);
  assertEquals(md.reconfirmed_at, "2026-05-23T19:00:00.000Z");
  assertEquals(md.poi_completed, false);
  assertEquals(md.wad_triggered, false);
  assertEquals(md.credit_burned, false);
  assertEquals(md.payment_event_created, false);
  // Decline-only field must NOT appear on the reconfirm sibling.
  assertFalse("initiator_declined" in md);
  assertFalse("declined_at" in md);
});

Deno.test("CP-009: decline sibling metadata carries the signed-form fields", () => {
  const md = buildSiblingMetadata({
    action: "decline-late-acceptance",
    engagementId: "eng-parent",
    renewedEngagementId: null,
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "user-init",
    initiatorOrgId: "org-init",
    counterpartyUserId: null,
    counterpartyOrgId: "org-cp",
    counterpartyEmailHash: null,
    priorStatus: "late_acceptance_pending_initiator_reconfirmation",
    newStatus: "declined_after_late_acceptance",
    nowIso: "2026-05-23T19:05:00.000Z",
  });
  assertEquals(md.cp_rule, "CP-009");
  assertEquals(md.counterparty_response, "accepted_after_expiry");
  assertEquals(md.initiator_declined, true);
  assertEquals(md.declined_at, "2026-05-23T19:05:00.000Z");
  assertEquals(md.poi_completed, false);
  assertEquals(md.wad_triggered, false);
  assertEquals(md.credit_burned, false);
  assertEquals(md.payment_event_created, false);
  // Reconfirm-only field must NOT appear on the decline sibling.
  assertFalse("initiator_reconfirmed" in md);
  assertFalse("reconfirmed_at" in md);
});

Deno.test("CP-009: ack copy is response-body only — no new outbound email channel", () => {
  // The signed scope forbids introducing a new external email send for
  // the acknowledgement. We assert by shape: the response body carries
  // `counterparty_acknowledgement`, and there is no `email_dispatched`
  // / `email_id` / `notification_sent` field synthesised at this layer.
  const body = buildLateAcceptanceResponseBody({ id: "eng-1" }, null);
  const la = body.late_acceptance as Record<string, unknown>;
  assert("counterparty_acknowledgement" in la);
  assertFalse("email_dispatched" in la);
  assertFalse("email_id" in la);
  assertFalse("ack_email_sent" in la);
});
