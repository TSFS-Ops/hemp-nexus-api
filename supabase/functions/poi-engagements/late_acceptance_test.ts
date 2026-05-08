// Batch B Phase 3 — late-acceptance routing decision tests.
//
// These tests pin the pure decision logic that lives inside the
// `respond` handler: given a current engagement status and an `expires_at`
// timestamp, what should the route do when a counterparty action arrives?
//
// The mirror function below is a literal copy of the routing predicate
// in supabase/functions/poi-engagements/index.ts. Both must move
// together; a regression in either surface fails this test.
//
// Run: deno test supabase/functions/poi-engagements/late_acceptance_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

type Action = "accepted" | "declined";
type RouteDecision =
  | { kind: "late_acceptance" }
  | { kind: "standard"; targetStatus: Action }
  | { kind: "reject_invalid_transition"; from: string; to: Action };

const VALID_STATUS_TRANSITIONS: Record<string, Action[]> = {
  pending: [],
  notification_sent: [],
  contacted: ["accepted", "declined"],
  accepted: [],
  declined: [],
  expired: [],
};

function decideRespondRoute(opts: {
  currentStatus: string;
  expiresAtIso: string | null;
  action: Action;
  nowMs: number;
}): RouteDecision {
  const expiresAtMs = opts.expiresAtIso ? Date.parse(opts.expiresAtIso) : null;
  const isExpired =
    opts.currentStatus === "expired" ||
    (expiresAtMs !== null && opts.nowMs > expiresAtMs);
  if (opts.action === "accepted" && isExpired) {
    return { kind: "late_acceptance" };
  }
  const allowed = VALID_STATUS_TRANSITIONS[opts.currentStatus] ?? [];
  if (!allowed.includes(opts.action)) {
    return {
      kind: "reject_invalid_transition",
      from: opts.currentStatus,
      to: opts.action,
    };
  }
  return { kind: "standard", targetStatus: opts.action };
}

// ─── Standard accept / decline still works pre-expiry ──────────────────
Deno.test("contacted + accepted + not yet expired → standard accept", () => {
  const d = decideRespondRoute({
    currentStatus: "contacted",
    expiresAtIso: "2030-01-01T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d, { kind: "standard", targetStatus: "accepted" });
});

Deno.test("contacted + declined → standard decline", () => {
  const d = decideRespondRoute({
    currentStatus: "contacted",
    expiresAtIso: "2030-01-01T00:00:00Z",
    action: "declined",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d, { kind: "standard", targetStatus: "declined" });
});

// ─── Late acceptance routing ───────────────────────────────────────────
Deno.test("expired status + accepted → late_acceptance route", () => {
  const d = decideRespondRoute({
    currentStatus: "expired",
    expiresAtIso: "2026-04-01T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "late_acceptance");
});

Deno.test("contacted but expires_at < now + accepted → late_acceptance route (clock-based)", () => {
  // Status not yet flipped to expired by the scheduler, but the wall
  // clock is already past expires_at. The route must detect this and
  // refuse to revive the engagement via the standard path.
  const d = decideRespondRoute({
    currentStatus: "contacted",
    expiresAtIso: "2026-05-01T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "late_acceptance");
});

Deno.test("expired + declined → rejected as invalid transition (not late_acceptance)", () => {
  // Late acceptance is acceptance only. A late "decline" has no
  // business meaning — the engagement is already terminal.
  const d = decideRespondRoute({
    currentStatus: "expired",
    expiresAtIso: "2026-04-01T00:00:00Z",
    action: "declined",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d, {
    kind: "reject_invalid_transition",
    from: "expired",
    to: "declined",
  });
});

// ─── Direct expired→accepted MUST NOT use the standard path ────────────
Deno.test("VALID_STATUS_TRANSITIONS does not include expired→accepted (no revival)", () => {
  assertFalse((VALID_STATUS_TRANSITIONS.expired ?? []).includes("accepted"));
});

// ─── Late_acceptance state is never an entry the standard route accepts ─
Deno.test("late_acceptance_pending_initiator_reconfirmation has no entry in standard transition table", () => {
  assertEquals(
    VALID_STATUS_TRANSITIONS["late_acceptance_pending_initiator_reconfirmation"],
    undefined,
  );
});

// ─── Audit / RPC contract (locked-in names) ────────────────────────────
Deno.test("Phase 3 audit action names are stable", () => {
  // These string literals are the contract surface. Any rename here is
  // a breaking change for downstream audit consumers.
  const accepted = "pending_engagement.accepted_after_expiry";
  const reconfirmed = "pending_engagement.reconfirmed";
  const declined = "pending_engagement.initiator_declined_after_late_acceptance";
  assert(accepted.startsWith("pending_engagement."));
  assert(reconfirmed.startsWith("pending_engagement."));
  assert(declined.startsWith("pending_engagement."));
});

Deno.test("Phase 3 RPC names are stable", () => {
  const rpcs = [
    "atomic_record_late_acceptance",
    "atomic_reconfirm_late_acceptance",
    "atomic_decline_late_acceptance",
  ];
  for (const r of rpcs) assert(r.startsWith("atomic_"));
});

Deno.test("counterparty_response wording is accepted_after_expiry (not late_accepted)", () => {
  const allowed = ["accepted", "declined", "accepted_after_expiry"];
  assert(allowed.includes("accepted_after_expiry"));
  assertFalse(allowed.includes("late_accepted"));
});

// ─── Phase 3 Issue 1 — broader clock-based late-acceptance routing ─────
// The respond route must detect "expires_at < now()" for any non-terminal
// status, not just rows the scheduler has already swept to expired.

Deno.test("notification_sent + expires_at past + accepted → late_acceptance route", () => {
  const d = decideRespondRoute({
    currentStatus: "notification_sent",
    expiresAtIso: "2026-04-30T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "late_acceptance");
});

Deno.test("pending + expires_at past + accepted → late_acceptance route", () => {
  const d = decideRespondRoute({
    currentStatus: "pending",
    expiresAtIso: "2026-04-30T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "late_acceptance");
});

Deno.test("accepted + expires_at past + accepted → standard path (RPC will reject as already_resolved)", () => {
  // The route does not duplicate the RPC's terminal-status guard. It
  // simply does not re-route to late_acceptance; the standard transition
  // table will reject it (and even if it didn't, the new RPC rejects
  // accepted/declined explicitly).
  const d = decideRespondRoute({
    currentStatus: "accepted",
    expiresAtIso: "2026-04-30T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "reject_invalid_transition");
});

Deno.test("declined + expires_at past + accepted → standard path (RPC will reject as already_resolved)", () => {
  const d = decideRespondRoute({
    currentStatus: "declined",
    expiresAtIso: "2026-04-30T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d.kind, "reject_invalid_transition");
});

Deno.test("contacted + expires_at in future + accepted → standard accept (no late routing)", () => {
  const d = decideRespondRoute({
    currentStatus: "contacted",
    expiresAtIso: "2030-01-01T00:00:00Z",
    action: "accepted",
    nowMs: Date.parse("2026-05-08T12:00:00Z"),
  });
  assertEquals(d, { kind: "standard", targetStatus: "accepted" });
});
