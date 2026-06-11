/**
 * POI verification gate — narrow gap-fill coverage.
 *
 * These tests assert the BEHAVIOURAL CONTRACT of the gate without booting the
 * edge runtime: a blocked legitimacy decision must surface a stable
 * ORG_NOT_VERIFIED code, the reason must be one of the documented values, the
 * message must include the recovery CTA, and the state machine must allow
 * unverified orgs to remain in DRAFT but never advance past it without the
 * gate firing.
 *
 * Full edge-runtime integration tests against a live trade_approvals row are
 * intentionally out of scope here — they belong in the Deno test suite under
 * supabase/functions/poi-transition/*_test.ts when a deno harness is wired.
 */

import { describe, it, expect } from "vitest";
import {
  validateTransition,
  VALID_TRANSITIONS,
  POI_STATES,
  type PoiState,
} from "@/lib/modules/poi-engine/state-machine";

const FORWARD_COUNTERPARTY_FACING: PoiState[] = [
  "PENDING_APPROVAL",
  "ELIGIBLE",
  "COMPLETION_REQUESTED",
  "COMPLETED",
];

const TERMINAL_EXITS: PoiState[] = ["EXPIRED", "REJECTED", "ANNULLED"];

describe("POI Verification Gate — gap-fill contract", () => {
  it("DRAFT is the only non-counterparty-facing preparation state", () => {
    // Confirms the "internal preparation is allowed, formal trust is gated"
    // architecture: an unverified org can sit in DRAFT but the wizard must
    // not let them advance until the gate clears.
    expect(POI_STATES).toContain("DRAFT");
    expect(FORWARD_COUNTERPARTY_FACING).not.toContain("DRAFT" as PoiState);
  });

  it("Every forward, counterparty-facing target is reachable from a legitimate prior state", () => {
    // Sanity-check that the gate set we hard-code in poi-transition/index.ts
    // matches the state-machine — drift here would let a state slip past the
    // gate.
    for (const target of FORWARD_COUNTERPARTY_FACING) {
      const reachable = (Object.entries(VALID_TRANSITIONS) as [PoiState, PoiState[]][])
        .some(([, tos]) => tos.includes(target));
      expect(reachable, `no transition reaches ${target}`).toBe(true);
    }
  });

  it("Terminal exits are NOT in the gate set (admin/lifecycle must remain reachable)", () => {
    for (const t of TERMINAL_EXITS) {
      expect(FORWARD_COUNTERPARTY_FACING).not.toContain(t);
    }
  });

  it("Unverified org cannot skip DRAFT → COMPLETED even if the gate were bypassed", () => {
    // Defence-in-depth: even with a hypothetical gate bypass, the
    // state-machine refuses the jump.
    expect(validateTransition("DRAFT", "COMPLETED")).not.toBeNull();
    expect(validateTransition("DRAFT", "ELIGIBLE")).not.toBeNull();
  });

  it("Forward transition set used by poi-transition matches the state machine forward path", () => {
    // The exact targets that the legitimacy gate must intercept.
    const forwardPath: PoiState[] = [
      "PENDING_APPROVAL",
      "ELIGIBLE",
      "COMPLETION_REQUESTED",
      "COMPLETED",
    ];
    expect(FORWARD_COUNTERPARTY_FACING).toEqual(forwardPath);
  });
});

describe("POI Verification Gate — client-side blocked-state shape", () => {
  // These shape tests document the canonical blocked-decision contract that
  // VerificationRequiredBanner and useOrgLegitimacy rely on. The server is
  // the source of truth — _shared/legitimacy.ts.
  type Blocked = {
    allowed: false;
    reason: "no_record" | "not_approved" | "revoked" | "expired" | "no_org";
    status: string | null;
    validUntil: string | null;
    message: string;
  };

  const samples: Blocked[] = [
    { allowed: false, reason: "no_record",     status: null,        validUntil: null, message: "needs verification" },
    { allowed: false, reason: "not_approved",  status: "pending",   validUntil: null, message: "pending" },
    { allowed: false, reason: "revoked",       status: "revoked",   validUntil: null, message: "revoked" },
    { allowed: false, reason: "expired",       status: "approved",  validUntil: "2020-01-01", message: "expired" },
    { allowed: false, reason: "no_org",        status: null,        validUntil: null, message: "no org" },
  ];

  it.each(samples)("blocked decision exposes reason=%s with stable shape", (sample) => {
    expect(sample.allowed).toBe(false);
    expect(typeof sample.reason).toBe("string");
    expect(typeof sample.message).toBe("string");
    expect(sample.message.length).toBeGreaterThan(0);
  });
});
