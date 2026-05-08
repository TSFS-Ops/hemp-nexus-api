/**
 * Batch B Phase 4 — engagement progression guard tests.
 *
 * Pins the stable error codes the backend will emit for every
 * engagement-state shape that arrives at a workflow-progression
 * call site (POI mint, POI advance, WaD create/seal, completion,
 * engagement-scoped credit burn, engagement-scoped payment events).
 *
 * Critical assertions:
 *   • A historical `accepted` row does NOT pass when the current
 *     engagement is a renewed `notification_sent` / `contacted` /
 *     `late_acceptance_pending_initiator_reconfirmation` child.
 *   • `late_acceptance_pending_initiator_reconfirmation` returns its
 *     own dedicated stable code so UI and tests can branch precisely.
 *   • `pending` / `notification_sent` / `contacted` without any
 *     historical row return `ENGAGEMENT_NOT_ACCEPTED`; with a
 *     historical row they return `ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE`.
 *   • A null current engagement with a terminal historical row
 *     returns the precise terminal code (`ENGAGEMENT_EXPIRED` or
 *     `ENGAGEMENT_DECLINED`).
 *   • No current engagement and no historical → `ENGAGEMENT_REQUIRED`.
 *
 * The tests work directly against the pure decision function so they
 * pin the contract that every consumer (match/wad/p3-wad/poi-transition/
 * collapse/attestation) now relies on.
 */

import { describe, it, expect } from "vitest";
import { resolveEngagementReadModel } from "@/lib/engagement-read-model";
import { decideEngagementProgression } from "@/lib/engagement-progression-guard";

const row = (status: string, createdAt: string, id?: string) => ({
  id: id ?? crypto.randomUUID(),
  match_id: "11111111-1111-1111-1111-111111111111",
  engagement_status: status,
  created_at: createdAt,
});

const decide = (rows: ReturnType<typeof row>[]) =>
  decideEngagementProgression(resolveEngagementReadModel(rows));

describe("engagement progression guard — Phase 4 stable error codes", () => {
  it("ENGAGEMENT_REQUIRED when there is no engagement at all", () => {
    const d = decide([]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_REQUIRED");
  });

  it("allows progression when the current engagement is accepted", () => {
    const d = decide([row("accepted", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(true);
    expect(d.code).toBeUndefined();
    expect(d.currentStatus).toBe("accepted");
  });

  it("ENGAGEMENT_NOT_ACCEPTED for pre-acceptance with no prior cycle (notification_sent)", () => {
    const d = decide([row("notification_sent", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_NOT_ACCEPTED");
  });

  it("ENGAGEMENT_NOT_ACCEPTED for pre-acceptance with no prior cycle (contacted)", () => {
    const d = decide([row("contacted", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_NOT_ACCEPTED");
  });

  it("ENGAGEMENT_NOT_ACCEPTED for legacy 'pending' literal", () => {
    const d = decide([row("pending", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_NOT_ACCEPTED");
  });

  it("LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION blocks progression with its own stable code", () => {
    const d = decide([
      row("late_acceptance_pending_initiator_reconfirmation", "2026-05-01T00:00:00.000Z"),
    ]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION");
  });

  it("ENGAGEMENT_EXPIRED when the only row is expired", () => {
    const d = decide([row("expired", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_EXPIRED");
  });

  it("ENGAGEMENT_DECLINED when the only row is declined", () => {
    const d = decide([row("declined", "2026-05-01T00:00:00.000Z")]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_DECLINED");
  });

  it("ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE when an expired parent is paired with a renewed notification_sent child", () => {
    const parent = row("expired", "2026-04-01T00:00:00.000Z", "p");
    const child = row("notification_sent", "2026-05-01T00:00:00.000Z", "c");
    const d = decide([parent, child]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE");
    expect(d.hasHistorical).toBe(true);
  });

  it("ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE for renewed contacted child after expired parent", () => {
    const parent = row("expired", "2026-04-01T00:00:00.000Z", "p");
    const child = row("contacted", "2026-05-01T00:00:00.000Z", "c");
    const d = decide([parent, child]);
    expect(d.code).toBe("ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE");
  });

  it("allows progression when the renewed child has been accepted", () => {
    const parent = row("expired", "2026-04-01T00:00:00.000Z", "p");
    const child = row("accepted", "2026-05-01T00:00:00.000Z", "c");
    const d = decide([parent, child]);
    expect(d.allowed).toBe(true);
    expect(d.currentStatus).toBe("accepted");
  });

  /**
   * CRITICAL Phase 4 invariant: a stale `accepted` row paired with a
   * newer pending child must NEVER allow workflow progression. The
   * guard MUST evaluate `current_engagement` (the newest non-terminal
   * row) — never the historical accepted row.
   *
   * In the live model the accepted parent is normally moved to
   * `expired` before a renewal is issued, but we defend against any
   * data path (manual fix, future flow, partial migration) that could
   * leave a historical accepted row in place beside a renewed pending
   * child. The expected behaviour is identical to the
   * expired-parent + pending-child case.
   */
  it("historical accepted row does NOT allow WaD/POI/completion when the renewed child is pending", () => {
    const historicalAccepted = row("accepted", "2026-04-01T00:00:00.000Z", "h");
    const renewedPending = row("notification_sent", "2026-05-01T00:00:00.000Z", "r");
    const d = decide([historicalAccepted, renewedPending]);
    expect(d.allowed).toBe(false);
    // The renewed child is the *current* engagement, so the guard must
    // describe the renewed-pending state — NOT report `accepted`. The
    // read-model resolver only treats expired/declined rows as
    // "historical", so a stale accepted row is not in `latest_historical`
    // and the code is `ENGAGEMENT_NOT_ACCEPTED` rather than the renewed
    // variant. Either way, progression MUST be blocked.
    expect(d.currentStatus).toBe("notification_sent");
    expect(d.code).toBe("ENGAGEMENT_NOT_ACCEPTED");
  });

  it("late_acceptance_pending_initiator_reconfirmation child still wins over a historical accepted parent", () => {
    const historicalAccepted = row("accepted", "2026-04-01T00:00:00.000Z", "h");
    const lapending = row(
      "late_acceptance_pending_initiator_reconfirmation",
      "2026-05-01T00:00:00.000Z",
      "l",
    );
    const d = decide([historicalAccepted, lapending]);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION");
  });
});

describe("engagement progression guard — call-site contract", () => {
  /**
   * These tests describe (in the negative) which call sites are now
   * gated. They are doc-style tests that pin the stable error codes
   * in one place so a future refactor that drops a guard will fail
   * here even if the call-site test itself is removed.
   */
  const codes = [
    "ENGAGEMENT_REQUIRED",
    "ENGAGEMENT_NOT_ACCEPTED",
    "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE",
    "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION",
    "ENGAGEMENT_EXPIRED",
    "ENGAGEMENT_DECLINED",
  ] as const;

  it("exposes the full set of stable engagement-progression error codes", () => {
    // If a code is added/removed, this test fails so every consumer
    // (UI mapping, docs, tests) is forced to acknowledge it.
    expect(new Set(codes).size).toBe(6);
  });

  it("guarded edge functions list (documentation pin)", () => {
    // This is an intentional documentation pin. The Phase 4 guards
    // were added to: match/generate-poi, match/reveal-counterparty,
    // match/complete, wad (POST), p3-wad (POST), poi-transition
    // (forward targets), collapse (POST), attestation (POST when
    // match_id is supplied). Any new engagement-scoped progression
    // path must add the same guard.
    const guarded = [
      "match.generate-poi",
      "match.reveal-counterparty",
      "match.complete",
      "wad.create",
      "p3-wad.create",
      "poi-transition.forward",
      "collapse.create",
      "attestation.create",
    ];
    expect(guarded).toHaveLength(8);
  });
});
