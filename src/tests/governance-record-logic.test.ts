/**
 * Governance Record (Phase 1) — pure-logic unit tests.
 * Exercises categorisation, status inference, actor inference, posture mapping,
 * redaction, normalisation, and merge/dedupe.
 */

import { describe, it, expect } from "vitest";
import {
  categoriseAction,
  inferActorType,
  inferPosture,
  inferStatus,
  mergeAndSort,
  normaliseAdminAuditLog,
  normaliseAuditLog,
  normaliseEventStore,
  normaliseMatchEvent,
  redactMetadata,
  statusCopy,
  NO_EVENT_COPY,
  DEMO_EVENT_COPY,
} from "@/lib/governance/governance-record";

describe("governance-record pure logic", () => {
  it("categorises common actions", () => {
    expect(categoriseAction("poi.created")).toBe("poi");
    expect(categoriseAction("wad.gate.passed")).toBe("wad");
    expect(categoriseAction("outreach.blocked.no_contact")).toBe("outreach");
    expect(categoriseAction("admin.manual_override.applied")).toBe("hq_decision");
    expect(categoriseAction("credit_burn_blocked")).toBe("credit");
    expect(categoriseAction("payment.refund")).toBe("payment");
    expect(categoriseAction("something.random.xyz")).toBe("other");
  });

  it("infers blocked, allowed, manual_review and neutral status", () => {
    expect(inferStatus("poi.blocked", {})).toBe("blocked");
    expect(inferStatus("wad.manual_review_required", {})).toBe("manual_review");
    expect(inferStatus("poi.created", {})).toBe("allowed");
    expect(inferStatus("foo.read", {})).toBe("neutral");
    expect(inferStatus("anything", { blocked: true })).toBe("blocked");
  });

  it("infers actor types from role/source", () => {
    expect(
      inferActorType({ source: "admin_audit_logs", action: "x" }),
    ).toBe("HQ Admin");
    expect(
      inferActorType({ source: "audit_logs", actorRole: "org_admin", action: "x" }),
    ).toBe("Organisation Admin");
    expect(
      inferActorType({ source: "audit_logs", action: "lifecycle.scheduler.tick" }),
    ).toBe("Scheduled Job");
    expect(
      inferActorType({ source: "audit_logs", action: "paystack.webhook" }),
    ).toBe("Payment Provider");
    expect(
      inferActorType({ source: "audit_logs", action: "unknown" }),
    ).toBe("Unknown actor — needs review");
  });

  it("maps posture labels and falls back to Not recorded", () => {
    expect(inferPosture({ posture: "waiver" }, false)).toBe("Waiver Applied");
    expect(inferPosture({ verification_posture: "bypass" }, false)).toBe("Bypass Applied");
    expect(inferPosture({}, true)).toBe("Demo/Test");
    expect(inferPosture({}, false)).toBe("Not recorded");
    expect(inferPosture({ posture: "garbage" }, false)).toBe("Not recorded");
  });

  it("redacts secrets, tokens, raw payloads and document urls", () => {
    const out = redactMetadata({
      password: "abc",
      api_key: "sk_live_xxx",
      auth_token: "y",
      raw_payload: { card_number: "4111" },
      document_url: "https://leaky",
      okay: "visible",
      nested: { service_role: "z", fine: 1 },
    });
    expect(out.password).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.raw_payload).toBe("[redacted]");
    expect(out.document_url).toBe("[redacted]");
    expect(out.okay).toBe("visible");
    expect((out.nested as any).service_role).toBe("[redacted]");
    expect((out.nested as any).fine).toBe(1);
  });

  it("normalises an audit_logs row including demo flag", () => {
    const e = normaliseAuditLog({
      id: "a1",
      action: "poi.blocked",
      entity_type: "match",
      entity_id: "m1",
      actor_user_id: "u1",
      org_id: "o1",
      created_at: "2026-05-24T00:00:00Z",
      is_demo: true,
      metadata: { reason: "no_evidence", match_id: "m1" },
    });
    expect(e.source).toBe("audit_logs");
    expect(e.category).toBe("poi");
    expect(e.status).toBe("blocked");
    expect(e.isDemo).toBe(true);
    expect(e.posture).toBe("Demo/Test");
    expect(e.links.matchId).toBe("m1");
    expect(e.reasonCode).toBe("no_evidence");
  });

  it("normalises an admin_audit_logs row as HQ Admin", () => {
    const e = normaliseAdminAuditLog({
      id: "x1",
      action: "admin.manual_override.applied",
      target_type: "match",
      target_id: "m1",
      admin_user_id: "admin1",
      created_at: "2026-05-24T00:00:00Z",
      details: { reason: "ops_request" },
    });
    expect(e.source).toBe("admin_audit_logs");
    expect(e.actorType).toBe("HQ Admin");
    expect(e.category).toBe("hq_decision");
  });

  it("normalises event_store and match_events rows", () => {
    const es = normaliseEventStore({
      id: "e1",
      event_type: "poi.state_changed",
      aggregate_type: "match",
      aggregate_id: "m1",
      occurred_at: "2026-05-24T00:00:00Z",
      actor_id: "u1",
      actor_role: "system",
      org_id: "o1",
      payload: { from_state: "DRAFT", to_state: "ELIGIBLE" },
    });
    expect(es.source).toBe("event_store");
    expect(es.prevState).toBe("DRAFT");
    expect(es.newState).toBe("ELIGIBLE");

    const me = normaliseMatchEvent({
      id: "me1",
      event_type: "match.created",
      match_id: "m1",
      org_id: "o1",
      actor_user_id: "u1",
      created_at: "2026-05-24T00:00:00Z",
      event_data: {},
    });
    expect(me.source).toBe("match_events");
    expect(me.links.matchId).toBe("m1");
    expect(me.category).toBe("match");
  });

  it("merges duplicates by (action, ~timestamp, matchId) preferring higher-trust source", () => {
    const t = "2026-05-24T00:00:00Z";
    const a = normaliseAuditLog({
      id: "a1",
      action: "poi.created",
      entity_type: "match",
      entity_id: "m1",
      actor_user_id: "u1",
      org_id: "o1",
      created_at: t,
      metadata: { match_id: "m1" },
    });
    const es = normaliseEventStore({
      id: "e1",
      event_type: "poi.created",
      aggregate_type: "match",
      aggregate_id: "m1",
      occurred_at: t,
      actor_id: "u1",
      payload: { match_id: "m1" },
    });
    const merged = mergeAndSort([a, es]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("event_store");
  });

  it("sorts chronologically descending", () => {
    const older = normaliseAuditLog({
      id: "a1",
      action: "match.created",
      entity_type: "match",
      entity_id: "m1",
      created_at: "2026-05-01T00:00:00Z",
      metadata: {},
    });
    const newer = normaliseAuditLog({
      id: "a2",
      action: "poi.created",
      entity_type: "match",
      entity_id: "m1",
      created_at: "2026-05-24T00:00:00Z",
      metadata: {},
    });
    const merged = mergeAndSort([older, newer]);
    expect(merged[0].sourceRowId).toBe("a2");
    expect(merged[1].sourceRowId).toBe("a1");
  });

  it("provides controlled copy for blocked / allowed / manual_review", () => {
    const blocked = normaliseAuditLog({
      id: "1",
      action: "poi.blocked",
      created_at: "2026-05-24T00:00:00Z",
      metadata: { reason: "no_evidence" },
    });
    expect(statusCopy(blocked)).toContain("Action blocked");
    expect(statusCopy(blocked)).toContain("no_evidence");

    const allowed = normaliseAuditLog({
      id: "2",
      action: "poi.created",
      created_at: "2026-05-24T00:00:00Z",
      metadata: {},
    });
    expect(statusCopy(allowed)).toContain("Action allowed");

    const manual = normaliseAuditLog({
      id: "3",
      action: "wad.manual_review_required",
      created_at: "2026-05-24T00:00:00Z",
      metadata: {},
    });
    expect(statusCopy(manual)).toContain("Manual review required");
  });

  it("exports controlled copy constants", () => {
    expect(NO_EVENT_COPY).toContain("No recorded event");
    expect(DEMO_EVENT_COPY).toContain("Demo/test event");
  });
});
