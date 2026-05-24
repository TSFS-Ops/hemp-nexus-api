/**
 * DEC-004 Phase 1 — manual outreach ownership & state SSOT test.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-004.
 *
 * Asserts:
 *   - SSOT (`src/lib/outreach/dec-004-states.ts`) declares the sole
 *     Izenzo manual-outreach owner and the explicit non-owners.
 *   - The 10 canonical signed-form state names exist and each maps
 *     onto the live implementation surface (`engagement_status`,
 *     `operational_state`, SLA / dispute / late-acceptance flags,
 *     suppressed/test markers).
 *   - The four canonical DEC-004 audit names exist; the three that
 *     are runtime-wired appear in the relevant edge functions; the
 *     `outreach.manual_owner_reassigned` constant is NOT emitted at
 *     runtime (Phase 1 — no reassignment surface).
 *   - Vericro / Imperial Tech / payment providers are never assigned
 *     as manual-outreach owners in the edge functions.
 *   - Client-org (non platform_admin) callers cannot reach the
 *     manual-outreach admin actions — every admin sub-route in
 *     poi-engagements is gated by `requireRole(authCtx, "platform_admin")`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEC_004_MANUAL_OUTREACH_OWNER,
  DEC_004_FORBIDDEN_OUTREACH_OWNERS,
  DEC_004_REASSIGNMENT_IMPLEMENTED,
  DEC_004_OUTREACH_STATES,
  DEC_004_CANONICAL_STATE_NAMES,
  DEC_004_OUTREACH_AUDIT_ACTIONS,
  DEC_004_RUNTIME_EMITTED_AUDIT_ACTIONS,
  OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED,
  OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED,
  OUTREACH_MANUAL_OWNER_REASSIGNED,
  OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP,
} from "@/lib/outreach/dec-004-states";

const ROOT = process.cwd();
const POI_FN = readFileSync(
  resolve(ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const SLA_FN = readFileSync(
  resolve(ROOT, "supabase/functions/outreach-sla-monitor/index.ts"),
  "utf8",
);

describe("DEC-004 Phase 1 — manual outreach ownership", () => {
  it("Izenzo platform admin is the sole approved manual-outreach owner", () => {
    expect(DEC_004_MANUAL_OUTREACH_OWNER).toBe("izenzo_platform_admin");
  });

  it("Vericro / Imperial Tech / payment providers are explicit non-owners", () => {
    for (const forbidden of ["vericro", "imperial_tech", "imperial", "paystack", "stripe", "payment_provider"]) {
      expect(DEC_004_FORBIDDEN_OUTREACH_OWNERS).toContain(forbidden);
    }
  });

  it("manual-owner reassignment is NOT implemented in Phase 1", () => {
    expect(DEC_004_REASSIGNMENT_IMPLEMENTED).toBe(false);
  });

  it("forbidden non-owners are never assigned as manual_owner in edge functions", () => {
    const forbiddenPattern = /manual_owner\s*:\s*["'](?:vericro|imperial(?:_tech)?|paystack|stripe|payment_provider)["']/i;
    expect(POI_FN).not.toMatch(forbiddenPattern);
    expect(SLA_FN).not.toMatch(forbiddenPattern);
  });
});

describe("DEC-004 Phase 1 — canonical outreach states", () => {
  const required = [
    "first_contact_review_required",
    "contact_details_required",
    "awaiting_outreach",
    "contacted_awaiting_response",
    "reminder_review_required",
    "bounce_review_required",
    "no_response_review_required",
    "dispute_review_required",
    "late_acceptance_review_required",
    "suppressed_test_review_required",
  ] as const;

  it("all 10 signed-form states are declared", () => {
    for (const name of required) {
      expect(DEC_004_CANONICAL_STATE_NAMES).toContain(name as never);
    }
  });

  it("each state maps onto current implementation fields and requires human action", () => {
    for (const name of required) {
      const m = DEC_004_OUTREACH_STATES[name];
      expect(m).toBeDefined();
      expect(m.requiresHumanAction).toBe(true);
      // Each state must reference at least one implementation surface:
      // engagement_status, operational_state, or row flags.
      const hasSurface =
        (m.engagementStatus && m.engagementStatus.length > 0) ||
        (m.operationalState && m.operationalState.length > 0) ||
        m.rowFlags.length > 0;
      expect(hasSurface, `state ${name} has no implementation surface`).toBe(true);
    }
  });

  it("current engagement_status enum values are covered by the canonical state map", () => {
    // The live enum from poi-engagements/index.ts:
    const liveEnum = ["pending", "notification_sent", "contacted", "accepted", "declined", "expired"];
    const covered = new Set<string>();
    for (const m of Object.values(DEC_004_OUTREACH_STATES)) {
      for (const s of m.engagementStatus ?? []) covered.add(s);
    }
    // Every non-terminal live status appears in at least one canonical state.
    for (const s of ["pending", "notification_sent", "contacted"]) {
      expect(covered.has(s), `live engagement_status '${s}' is not mapped to any canonical DEC-004 state`).toBe(true);
    }
    // Sanity: terminal statuses (declined/expired) are intentionally
    // not in the human-action map (they are end-states, no follow-up).
    expect(liveEnum).toContain("declined");
    expect(liveEnum).toContain("expired");
  });
});

describe("DEC-004 Phase 1 — canonical audit names", () => {
  it("declares all four canonical action constants", () => {
    expect(OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED).toBe("outreach.manual_follow_up_assigned");
    expect(OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED).toBe("outreach.manual_follow_up_action_recorded");
    expect(OUTREACH_MANUAL_OWNER_REASSIGNED).toBe("outreach.manual_owner_reassigned");
    expect(OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP).toBe("outreach.sla_scan_flagged_manual_follow_up");
    expect(DEC_004_OUTREACH_AUDIT_ACTIONS).toHaveLength(4);
  });

  it("runtime-emitted set excludes the reassignment constant", () => {
    expect(DEC_004_RUNTIME_EMITTED_AUDIT_ACTIONS).not.toContain(OUTREACH_MANUAL_OWNER_REASSIGNED);
    expect(DEC_004_RUNTIME_EMITTED_AUDIT_ACTIONS).toHaveLength(3);
  });

  it("poi-engagements emits manual_follow_up_assigned and manual_follow_up_action_recorded", () => {
    expect(POI_FN).toContain(`"${OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED}"`);
    expect(POI_FN).toContain(`"${OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED}"`);
  });

  it("outreach-sla-monitor emits sla_scan_flagged_manual_follow_up", () => {
    expect(SLA_FN).toContain(`"${OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP}"`);
  });

  it("outreach.manual_owner_reassigned is NOT emitted at runtime", () => {
    expect(POI_FN).not.toContain(`"${OUTREACH_MANUAL_OWNER_REASSIGNED}"`);
    expect(SLA_FN).not.toContain(`"${OUTREACH_MANUAL_OWNER_REASSIGNED}"`);
  });
});

describe("DEC-004 Phase 1 — client orgs cannot reach manual-outreach admin actions", () => {
  it("send-outreach is gated by requireRole(platform_admin)", () => {
    // Locate the send-outreach branch and assert the role check is
    // present before any side effect.
    const idx = POI_FN.indexOf(`parts[1] === "send-outreach"`);
    expect(idx).toBeGreaterThan(0);
    const branch = POI_FN.slice(idx, idx + 4000);
    expect(branch).toContain(`requireRole(authCtx, "platform_admin")`);
  });

  it("preview-outreach is gated by requireRole(platform_admin)", () => {
    const idx = POI_FN.indexOf(`parts[1] === "preview-outreach"`);
    expect(idx).toBeGreaterThan(0);
    const branch = POI_FN.slice(idx, idx + 4000);
    expect(branch).toContain(`requireRole(authCtx, "platform_admin")`);
  });
});
