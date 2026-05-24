/**
 * DEC-001 Phase 1 — canonical off-platform outreach audit test.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-001.
 *
 * Asserts:
 *   - The SSOT (`src/lib/outreach/dec-001-audit.ts`) declares the three
 *     canonical action names verbatim.
 *   - Those canonical names appear as string literals in the live edge
 *     function (`supabase/functions/poi-engagements/index.ts`).
 *   - The pre-existing per-reason block audit rows are preserved (we
 *     dual-write, never replace).
 *   - Outreach paths in the edge function do NOT mint POI, burn
 *     credit, trigger WaD, or create a payment event (enforced by
 *     scanning for forbidden side-effect call-sites inside outreach
 *     branches).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OFF_PLATFORM_OUTREACH_EVALUATED,
  OFF_PLATFORM_OUTREACH_SENT,
  OFF_PLATFORM_OUTREACH_BLOCKED,
  DEC_001_OUTREACH_AUDIT_ACTIONS,
  DEC_001_BLOCKED_REASONS,
  DEC_001_OUTREACH_FORBIDDEN_SIDE_EFFECTS,
} from "@/lib/outreach/dec-001-audit";

const ROOT = process.cwd();
const POI_FN = readFileSync(
  resolve(ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("DEC-001 Phase 1 — off-platform outreach audit SSOT", () => {
  it("declares the three canonical action constants", () => {
    expect(OFF_PLATFORM_OUTREACH_EVALUATED).toBe(
      "pending_engagement.off_platform_outreach_evaluated",
    );
    expect(OFF_PLATFORM_OUTREACH_SENT).toBe(
      "pending_engagement.off_platform_outreach_sent",
    );
    expect(OFF_PLATFORM_OUTREACH_BLOCKED).toBe(
      "pending_engagement.off_platform_outreach_blocked",
    );
    expect(DEC_001_OUTREACH_AUDIT_ACTIONS).toHaveLength(3);
  });

  it("declares the canonical blocked_reason discriminators", () => {
    for (const reason of [
      "contact_email_missing",
      "contact_name_missing",
      "contact_incomplete",
      "binding_review_required",
      "disputed_being_named",
      "engagement_superseded",
      "engagement_expired",
      "engagement_cancelled",
      "match_progression_refused",
      "compliance_or_legal_hold",
      "unsafe_wording",
    ]) {
      expect(DEC_001_BLOCKED_REASONS).toContain(reason);
    }
  });
});

describe("DEC-001 Phase 1 — runtime emission", () => {
  for (const name of DEC_001_OUTREACH_AUDIT_ACTIONS) {
    it(`emits ${name} from poi-engagements`, () => {
      expect(POI_FN).toContain(`"${name}"`);
    });
  }

  it("preserves the pre-existing per-reason block audits (dual-write, not replace)", () => {
    for (const legacy of [
      "outreach.blocked.contact_incomplete",
      "outreach.blocked.binding_review_pending",
      "outreach.blocked.disputed_being_named",
      "pending_engagement.outreach_blocked_binding_review_required",
      "pending_engagement.outreach_blocked_missing_email",
      "pending_engagement.outreach_blocked_missing_name",
      "pending_engagement.outreach_blocked_missing_counterparty_name",
      "engagement.outreach_email_queued",
      "engagement.outreach_governance_snapshot",
    ]) {
      expect(POI_FN).toContain(`"${legacy}"`);
    }
  });
});

describe("DEC-001 Phase 1 — outreach has no POI / WaD / credit / payment side effects", () => {
  // Extract the send-outreach branch: from `parts[1] === "send-outreach"`
  // to the next top-level branch (`parts[1] === "preview-outreach"` was
  // emitted earlier in the file, so the send branch is bounded by the
  // next `if (req.method === ` after its start).
  const SEND_BRANCH_START_MARKER = `parts[1] === "send-outreach"`;
  const startIdx = POI_FN.indexOf(SEND_BRANCH_START_MARKER);
  expect(startIdx).toBeGreaterThan(0);
  const tail = POI_FN.slice(startIdx);
  // Bound the slice generously — the next `if (req.method === "POST"`
  // for a different sub-route closes the branch for our purposes.
  const nextRouteIdx = tail.indexOf("\n    if (req.method === ", 200);
  const sendBranch = nextRouteIdx > 0 ? tail.slice(0, nextRouteIdx) : tail;

  for (const sideEffect of DEC_001_OUTREACH_FORBIDDEN_SIDE_EFFECTS) {
    it(`does not invoke ${sideEffect} inside the send-outreach branch`, () => {
      expect(sendBranch.toLowerCase()).not.toContain(sideEffect.toLowerCase());
    });
  }

  it("the canonical sent row explicitly declares no POI / WaD / credit / payment side effects", () => {
    expect(POI_FN).toContain("poi_minted: false");
    expect(POI_FN).toContain("wad_triggered: false");
    expect(POI_FN).toContain("credit_burned: false");
    expect(POI_FN).toContain("payment_event: false");
  });
});

describe("DEC-001 Phase 1 — block branches cover the signed-form refusal set", () => {
  it("blocks missing email / missing name before any send side-effect", () => {
    // The per-reason block audits being preserved (asserted above) is
    // the primary contract; here we additionally pin that the
    // canonical blocked row carries the right reason discriminators.
    expect(POI_FN).toContain('blocked_reason:\n                  sendState === "email_missing"');
    expect(POI_FN).toContain('blocked_reason:\n                  previewState === "email_missing"');
  });

  it("blocks disputed-being-named and binding-review-required engagements", () => {
    expect(POI_FN).toContain('blocked_reason:\n                  gate.code === "DISPUTED_BEING_NAMED"');
  });
});
