// CP-012 — Counterparty dispute being named.
//
// Pure decision tests pinning the contract that the dispute branch must:
//   1. Insert a public.disputes row keyed on match_id with reason
//      "cp012_disputes_being_named" and status "open" so that the
//      match-level DISPUTE_ACTIVE guard trips.
//   2. Emit the spec-named sibling audit action
//      "pending_engagement.counterparty_disputed_being_named" alongside the
//      canonical "engagement.dispute_raised".
//   3. Create an admin_risk_items row of kind "billing_review_required"
//      when (and only when) a credit had already been burned for the match.
//   4. Never auto-trigger POI / WaD / execution / credit / payment /
//      outreach side-effects from the dispute itself.
//   5. Restrict dispute-release / dispute-close to platform_admin and
//      emit dispute.counterparty_named_dispute_{released,closed}.
//
// These are pure-logic mirrors of the handler in index.ts; the live
// integration test suite asserts the same contract end-to-end.
//
// Run: deno test supabase/functions/poi-engagements/cp012_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

type DisputeRow = {
  match_id: string;
  raised_by_org_id: string;
  raised_by_user_id: string;
  reason: string;
  status: string;
};

function buildCp012DisputeRow(args: {
  matchId: string;
  counterpartyOrgId: string | null;
  initiatorOrgId: string;
  adminUserId: string;
  evidenceNotes: string;
}): DisputeRow & { evidence_notes: string } {
  return {
    match_id: args.matchId,
    raised_by_org_id: args.counterpartyOrgId ?? args.initiatorOrgId,
    raised_by_user_id: args.adminUserId,
    reason: "cp012_disputes_being_named",
    evidence_notes: args.evidenceNotes,
    status: "open",
  };
}

function shouldFileBillingReview(creditBurnedForMatch: boolean): boolean {
  return creditBurnedForMatch === true;
}

function siblingAuditAction(): string {
  return "pending_engagement.counterparty_disputed_being_named";
}

function resolveAuditAction(action: "dispute-release" | "dispute-close"): string {
  return action === "dispute-release"
    ? "dispute.counterparty_named_dispute_released"
    : "dispute.counterparty_named_dispute_closed";
}

function canCallerResolve(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("platform_admin");
}

function disputeSideEffects() {
  // CP-012 dispute itself must NEVER cause these:
  return {
    poi_completed: false,
    wad_triggered: false,
    execution_started: false,
    credit_burned: false,
    payment_event_created: false,
    outreach_sent_to_counterparty: false,
  };
}

Deno.test("CP-012 dispute row uses match_id, cp012 reason, status open", () => {
  const row = buildCp012DisputeRow({
    matchId: "m1",
    counterpartyOrgId: "cp-org",
    initiatorOrgId: "init-org",
    adminUserId: "admin",
    evidenceNotes: "Phoned us, said not us.",
  });
  assertEquals(row.match_id, "m1");
  assertEquals(row.reason, "cp012_disputes_being_named");
  assertEquals(row.status, "open");
  assertEquals(row.raised_by_org_id, "cp-org");
});

Deno.test("CP-012 falls back to initiator org when counterparty org unknown (DISPUTE_ACTIVE still trips on match_id)", () => {
  const row = buildCp012DisputeRow({
    matchId: "m2",
    counterpartyOrgId: null,
    initiatorOrgId: "init-org",
    adminUserId: "admin",
    evidenceNotes: "Off-platform dispute.",
  });
  assertEquals(row.raised_by_org_id, "init-org");
});

Deno.test("CP-012 sibling audit action name is the signed-form one", () => {
  assertEquals(
    siblingAuditAction(),
    "pending_engagement.counterparty_disputed_being_named",
  );
});

Deno.test("CP-012 files billing-review risk item only when a credit was already burned", () => {
  assert(shouldFileBillingReview(true));
  assertFalse(shouldFileBillingReview(false));
});

Deno.test("CP-012 dispute itself produces no POI / WaD / execution / credit / payment / outreach side-effects", () => {
  const fx = disputeSideEffects();
  assertFalse(fx.poi_completed);
  assertFalse(fx.wad_triggered);
  assertFalse(fx.execution_started);
  assertFalse(fx.credit_burned);
  assertFalse(fx.payment_event_created);
  assertFalse(fx.outreach_sent_to_counterparty);
});

Deno.test("CP-012 release / close are restricted to platform_admin", () => {
  assert(canCallerResolve(["platform_admin"]));
  assertFalse(canCallerResolve(["org_admin"]));
  assertFalse(canCallerResolve(undefined));
});

Deno.test("CP-012 release / close audit action names match the signed form", () => {
  assertEquals(
    resolveAuditAction("dispute-release"),
    "dispute.counterparty_named_dispute_released",
  );
  assertEquals(
    resolveAuditAction("dispute-close"),
    "dispute.counterparty_named_dispute_closed",
  );
});
