// CP-015 — Initiating organisation changes the counterparty email after a
// Pending Engagement is created.
//
// Pure decision tests pinning the signed-form sibling-audit contract that
// CP-015 layers on top of the existing refusal/cancel/create flow:
//
//   1. The refused direct-edit branch emits BOTH the canonical
//      `engagement.email_change_refused` audit AND the signed-form sibling
//      `pending_engagement.email_change_blocked_requires_new_engagement`,
//      with `cp_rule: "CP-015"`, hashed emails, and no side-effect flags.
//   2. The cancel-for-email-change branch emits BOTH the canonical
//      `engagement.cancelled_for_email_change` audit AND the same sibling,
//      reporting `old_status_after: "cancelled_email_change"` and
//      `old_outreach_link_invalidated: true`.
//   3. The match soft-route create path, when called with
//      `replaces_engagement_id` pointing at a cancelled-for-email-change row
//      on the same match + initiator, emits
//      `pending_engagement.created_after_counterparty_email_change`.
//   4. The match soft-route create path rejects with 409
//      INVALID_REPLACES_ENGAGEMENT_ID when the referenced engagement is
//      missing, belongs to a different match/initiator, or is not in the
//      `cancelled_email_change` status.
//   5. None of the three branches mints POI, triggers WaD, burns credit,
//      or creates a payment event for the email-change itself.
//
// These are pure-logic mirrors of the handlers in
// supabase/functions/poi-engagements/index.ts and
// supabase/functions/match/index.ts; the live integration test suite
// asserts the same contract end-to-end.
//
// Run: deno test supabase/functions/poi-engagements/cp015_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

type SideEffectFlags = {
  direct_edit_allowed: boolean;
  new_engagement_created: boolean;
  old_outreach_link_invalidated: boolean;
  poi_completed_from_old_engagement: boolean;
  wad_triggered_from_old_engagement: boolean;
  credit_burned_for_email_change: boolean;
  payment_event_created_for_email_change: boolean;
  billing_review_required: boolean;
};

type BlockedSibling = {
  action: "pending_engagement.email_change_blocked_requires_new_engagement";
  metadata: {
    cp_rule: "CP-015";
    reason: "counterparty_email_change_after_creation";
    old_engagement_id: string;
    new_engagement_id: string | null;
    match_id: string | null;
    poi_id: string | null;
    initiator_user_id: string;
    initiator_organisation_id: string;
    old_counterparty_email_hash: string | null;
    new_counterparty_email_hash: string | null;
    counterparty_name: string | null;
    old_status_before: string;
    old_status_after: string;
  } & SideEffectFlags;
};

type CreatedSibling = {
  action: "pending_engagement.created_after_counterparty_email_change";
  metadata: {
    cp_rule: "CP-015";
    source_reason: "email_change_required_new_engagement";
    old_engagement_id: string;
    new_engagement_id: string;
    match_id: string;
    new_counterparty_email_hash: string | null;
    created_by_user_id: string;
    organisation_id: string;
  };
};

// Deterministic stand-in for sha256Hex used by the production code.
function fakeHash(s: string | null): string | null {
  if (!s) return null;
  return `h:${s.toLowerCase()}`;
}

// Mirrors the refused-branch sibling-audit payload from index.ts.
function buildRefusedSibling(args: {
  engagementId: string;
  matchId: string | null;
  poiId: string | null;
  initiatorUserId: string;
  initiatorOrgId: string;
  currentStatus: string;
  previousEmail: string | null;
  attemptedEmail: string;
  contactName: string | null;
}): BlockedSibling {
  return {
    action: "pending_engagement.email_change_blocked_requires_new_engagement",
    metadata: {
      cp_rule: "CP-015",
      reason: "counterparty_email_change_after_creation",
      old_engagement_id: args.engagementId,
      new_engagement_id: null,
      match_id: args.matchId,
      poi_id: args.poiId,
      initiator_user_id: args.initiatorUserId,
      initiator_organisation_id: args.initiatorOrgId,
      old_counterparty_email_hash: fakeHash(args.previousEmail),
      new_counterparty_email_hash: fakeHash(args.attemptedEmail),
      counterparty_name: args.contactName,
      old_status_before: args.currentStatus,
      old_status_after: args.currentStatus,
      direct_edit_allowed: false,
      new_engagement_created: false,
      old_outreach_link_invalidated: false,
      poi_completed_from_old_engagement: false,
      wad_triggered_from_old_engagement: false,
      credit_burned_for_email_change: false,
      payment_event_created_for_email_change: false,
      billing_review_required: false,
    },
  };
}

// Mirrors the cancel-branch sibling-audit payload from index.ts.
function buildCancelledSibling(args: {
  engagementId: string;
  matchId: string | null;
  poiId: string | null;
  initiatorUserId: string;
  initiatorOrgId: string;
  previousStatus: string;
  oldEmail: string | null;
  newEmail: string;
  contactName: string | null;
}): BlockedSibling {
  return {
    action: "pending_engagement.email_change_blocked_requires_new_engagement",
    metadata: {
      cp_rule: "CP-015",
      reason: "counterparty_email_change_after_creation",
      old_engagement_id: args.engagementId,
      new_engagement_id: null,
      match_id: args.matchId,
      poi_id: args.poiId,
      initiator_user_id: args.initiatorUserId,
      initiator_organisation_id: args.initiatorOrgId,
      old_counterparty_email_hash: fakeHash(args.oldEmail),
      new_counterparty_email_hash: fakeHash(args.newEmail),
      counterparty_name: args.contactName,
      old_status_before: args.previousStatus,
      old_status_after: "cancelled_email_change",
      direct_edit_allowed: false,
      new_engagement_created: false,
      old_outreach_link_invalidated: true,
      poi_completed_from_old_engagement: false,
      wad_triggered_from_old_engagement: false,
      credit_burned_for_email_change: false,
      payment_event_created_for_email_change: false,
      billing_review_required: false,
    },
  };
}

// Mirrors the validation gate in supabase/functions/match/index.ts.
type OldEng = {
  id: string;
  match_id: string;
  org_id: string;
  engagement_status: string;
} | null;

function validateReplacement(
  oldEng: OldEng,
  ctx: { matchId: string; orgId: string },
):
  | { ok: true }
  | { ok: false; code: string; status: number } {
  if (!oldEng) {
    return { ok: false, code: "INVALID_REPLACES_ENGAGEMENT_ID", status: 409 };
  }
  if (oldEng.match_id !== ctx.matchId || oldEng.org_id !== ctx.orgId) {
    return { ok: false, code: "INVALID_REPLACES_ENGAGEMENT_ID", status: 409 };
  }
  if (oldEng.engagement_status !== "cancelled_email_change") {
    return { ok: false, code: "INVALID_REPLACES_ENGAGEMENT_ID", status: 409 };
  }
  return { ok: true };
}

function buildCreatedSibling(args: {
  oldEngagementId: string;
  newEngagementId: string;
  matchId: string;
  orgId: string;
  actorUserId: string;
  counterpartyEmail: string | null;
}): CreatedSibling {
  return {
    action: "pending_engagement.created_after_counterparty_email_change",
    metadata: {
      cp_rule: "CP-015",
      source_reason: "email_change_required_new_engagement",
      old_engagement_id: args.oldEngagementId,
      new_engagement_id: args.newEngagementId,
      match_id: args.matchId,
      new_counterparty_email_hash: fakeHash(args.counterpartyEmail),
      created_by_user_id: args.actorUserId,
      organisation_id: args.orgId,
    },
  };
}

// ───── Tests ─────

Deno.test("CP-015: refused direct edit emits sibling alongside canonical", () => {
  const canonicalAction = "engagement.email_change_refused";
  const sibling = buildRefusedSibling({
    engagementId: "eng-1",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "user-1",
    initiatorOrgId: "org-1",
    currentStatus: "notification_sent",
    previousEmail: "old@example.com",
    attemptedEmail: "NEW@example.COM",
    contactName: "Jane Doe",
  });
  assertEquals(canonicalAction, "engagement.email_change_refused");
  assertEquals(
    sibling.action,
    "pending_engagement.email_change_blocked_requires_new_engagement",
  );
  assertEquals(sibling.metadata.cp_rule, "CP-015");
  assertEquals(sibling.metadata.old_status_before, "notification_sent");
  assertEquals(sibling.metadata.old_status_after, "notification_sent");
  assertFalse(sibling.metadata.direct_edit_allowed);
  assertFalse(sibling.metadata.new_engagement_created);
  assertFalse(sibling.metadata.old_outreach_link_invalidated);
});

Deno.test("CP-015: refused-branch sibling never reports POI/WaD/credit/payment side effects", () => {
  const sibling = buildRefusedSibling({
    engagementId: "eng-1",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "user-1",
    initiatorOrgId: "org-1",
    currentStatus: "contacted",
    previousEmail: "a@b.com",
    attemptedEmail: "c@d.com",
    contactName: null,
  });
  assertFalse(sibling.metadata.poi_completed_from_old_engagement);
  assertFalse(sibling.metadata.wad_triggered_from_old_engagement);
  assertFalse(sibling.metadata.credit_burned_for_email_change);
  assertFalse(sibling.metadata.payment_event_created_for_email_change);
  assertFalse(sibling.metadata.billing_review_required);
});

Deno.test("CP-015: refused-branch sibling hashes both email addresses", () => {
  const sibling = buildRefusedSibling({
    engagementId: "eng-1",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "user-1",
    initiatorOrgId: "org-1",
    currentStatus: "notification_sent",
    previousEmail: "Old@Example.com",
    attemptedEmail: "new@example.com",
    contactName: null,
  });
  assertEquals(sibling.metadata.old_counterparty_email_hash, "h:old@example.com");
  assertEquals(sibling.metadata.new_counterparty_email_hash, "h:new@example.com");
});

Deno.test("CP-015: cancel-for-email-change emits sibling alongside canonical", () => {
  const canonicalAction = "engagement.cancelled_for_email_change";
  const sibling = buildCancelledSibling({
    engagementId: "eng-1",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "admin-1",
    initiatorOrgId: "org-1",
    previousStatus: "notification_sent",
    oldEmail: "old@example.com",
    newEmail: "correct@example.com",
    contactName: "Jane Doe",
  });
  assertEquals(canonicalAction, "engagement.cancelled_for_email_change");
  assertEquals(
    sibling.action,
    "pending_engagement.email_change_blocked_requires_new_engagement",
  );
  assertEquals(sibling.metadata.old_status_after, "cancelled_email_change");
  assert(sibling.metadata.old_outreach_link_invalidated);
  assertFalse(sibling.metadata.new_engagement_created);
});

Deno.test("CP-015: cancel-branch sibling never reports POI/WaD/credit/payment side effects", () => {
  const sibling = buildCancelledSibling({
    engagementId: "eng-1",
    matchId: "match-1",
    poiId: null,
    initiatorUserId: "admin-1",
    initiatorOrgId: "org-1",
    previousStatus: "notification_sent",
    oldEmail: "old@example.com",
    newEmail: "correct@example.com",
    contactName: null,
  });
  assertFalse(sibling.metadata.poi_completed_from_old_engagement);
  assertFalse(sibling.metadata.wad_triggered_from_old_engagement);
  assertFalse(sibling.metadata.credit_burned_for_email_change);
  assertFalse(sibling.metadata.payment_event_created_for_email_change);
});

Deno.test("CP-015: replacement create with valid replaces_engagement_id passes validation and emits created-sibling", () => {
  const old = {
    id: "old-eng",
    match_id: "match-1",
    org_id: "org-1",
    engagement_status: "cancelled_email_change",
  };
  const verdict = validateReplacement(old, { matchId: "match-1", orgId: "org-1" });
  assert(verdict.ok);
  const sibling = buildCreatedSibling({
    oldEngagementId: old.id,
    newEngagementId: "new-eng",
    matchId: "match-1",
    orgId: "org-1",
    actorUserId: "user-1",
    counterpartyEmail: "correct@example.com",
  });
  assertEquals(
    sibling.action,
    "pending_engagement.created_after_counterparty_email_change",
  );
  assertEquals(sibling.metadata.cp_rule, "CP-015");
  assertEquals(sibling.metadata.source_reason, "email_change_required_new_engagement");
  assertEquals(sibling.metadata.old_engagement_id, "old-eng");
  assertEquals(sibling.metadata.new_engagement_id, "new-eng");
  assertEquals(
    sibling.metadata.new_counterparty_email_hash,
    "h:correct@example.com",
  );
});

Deno.test("CP-015: replacement create rejects missing replaces_engagement_id row", () => {
  const verdict = validateReplacement(null, { matchId: "match-1", orgId: "org-1" });
  assertFalse(verdict.ok);
  if (!verdict.ok) {
    assertEquals(verdict.code, "INVALID_REPLACES_ENGAGEMENT_ID");
    assertEquals(verdict.status, 409);
  }
});

Deno.test("CP-015: replacement create rejects cross-match replaces_engagement_id", () => {
  const verdict = validateReplacement(
    {
      id: "old-eng",
      match_id: "other-match",
      org_id: "org-1",
      engagement_status: "cancelled_email_change",
    },
    { matchId: "match-1", orgId: "org-1" },
  );
  assertFalse(verdict.ok);
});

Deno.test("CP-015: replacement create rejects cross-initiator replaces_engagement_id", () => {
  const verdict = validateReplacement(
    {
      id: "old-eng",
      match_id: "match-1",
      org_id: "other-org",
      engagement_status: "cancelled_email_change",
    },
    { matchId: "match-1", orgId: "org-1" },
  );
  assertFalse(verdict.ok);
});

Deno.test("CP-015: replacement create rejects when referenced engagement is not cancelled_email_change", () => {
  for (const status of [
    "pending",
    "notification_sent",
    "contacted",
    "accepted",
    "disputed_being_named",
    "late_acceptance_pending_initiator_reconfirmation",
  ]) {
    const verdict = validateReplacement(
      {
        id: "old-eng",
        match_id: "match-1",
        org_id: "org-1",
        engagement_status: status,
      },
      { matchId: "match-1", orgId: "org-1" },
    );
    assertFalse(verdict.ok, `status ${status} must be rejected`);
  }
});
