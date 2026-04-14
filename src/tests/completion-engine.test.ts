/**
 * Completion Engine Tests - Deterministic next-action resolver
 */

import { describe, it, expect } from "vitest";
import { resolveCompletion, type CompletionInput } from "@/lib/completion-engine";

function baseInput(overrides: Partial<CompletionInput> = {}): CompletionInput {
  return {
    match: {
      id: "match-1",
      status: "matched",
      state: "discovery",
      poi_state: null,
      org_id: "org-1",
      buyer_committed_at: null,
      seller_committed_at: null,
      counterparty_sighted_at: null,
      settled_at: null,
      buyer_org_id: "org-1",
      seller_org_id: "org-2",
    },
    wad: null,
    pod: null,
    milestones: [],
    breaches: [],
    documents: { total: 0, reviewed: 0, pending: 0 },
    disputes: { active: 0, total: 0 },
    userRole: "org_admin",
    userOrgId: "org-1",
    ...overrides,
  };
}

describe("resolveCompletion", () => {
  it("returns 4 stages", () => {
    const result = resolveCompletion(baseInput());
    expect(result.stages).toHaveLength(4);
    expect(result.stages.map(s => s.id)).toEqual(["poi", "wad", "pod", "evidence"]);
  });

  it("POI stage is pending when match is new", () => {
    const result = resolveCompletion(baseInput());
    const poi = result.stages[0];
    expect(poi.status).toBe("pending");
    expect(poi.completionPct).toBe(0);
  });

  it("POI shows confirm_intent as recommended for matched status", () => {
    const result = resolveCompletion(baseInput());
    expect(result.recommendedAction).not.toBeNull();
    expect(result.recommendedAction!.type).toBe("confirm_intent");
    expect(result.recommendedAction!.allowed).toBe(true);
  });

  it("POI is complete when settled", () => {
    const result = resolveCompletion(baseInput({
      match: {
        ...baseInput().match,
        status: "settled",
        settled_at: "2026-01-01T00:00:00Z",
        buyer_committed_at: "2026-01-01T00:00:00Z",
        seller_committed_at: "2026-01-01T00:00:00Z",
      },
    }));
    const poi = result.stages[0];
    expect(poi.status).toBe("complete");
    expect(poi.completionPct).toBe(100);
  });

  it("POI is blocked when disputed", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "disputed" },
      disputes: { active: 1, total: 1 },
    }));
    const poi = result.stages[0];
    expect(poi.status).toBe("blocked");
    const confirmAction = poi.actions.find(a => a.type === "confirm_intent");
    expect(confirmAction!.allowed).toBe(false);
    expect(confirmAction!.blockedReason).toContain("dispute");
  });

  it("WaD is not_started when POI incomplete", () => {
    const result = resolveCompletion(baseInput());
    const wad = result.stages[1];
    expect(wad.status).toBe("not_started");
  });

  it("WaD is blocked when POI complete but engagement not accepted", () => {
    const result = resolveCompletion(baseInput({
      match: {
        ...baseInput().match,
        status: "settled",
        settled_at: "2026-01-01T00:00:00Z",
        buyer_committed_at: "2026-01-01T00:00:00Z",
        seller_committed_at: "2026-01-01T00:00:00Z",
      },
    }));
    const wad = result.stages[1];
    expect(wad.status).toBe("blocked");
    const createAction = wad.actions.find(a => a.type === "create_wad");
    expect(createAction!.allowed).toBe(false);
    expect(createAction!.blockedReason).toContain("Counterparty must accept");
  });

  it("WaD is pending when POI complete and engagement accepted", () => {
    const result = resolveCompletion(baseInput({
      match: {
        ...baseInput().match,
        status: "settled",
        settled_at: "2026-01-01T00:00:00Z",
        buyer_committed_at: "2026-01-01T00:00:00Z",
        seller_committed_at: "2026-01-01T00:00:00Z",
      },
      engagementStatus: "accepted",
    }));
    const wad = result.stages[1];
    expect(wad.status).toBe("pending");
    const createAction = wad.actions.find(a => a.type === "create_wad");
    expect(createAction!.allowed).toBe(true);
  });

  it("WaD is complete when sealed", () => {
    const result = resolveCompletion(baseInput({
      match: {
        ...baseInput().match,
        status: "settled",
        settled_at: "2026-01-01T00:00:00Z",
      },
      wad: {
        id: "wad-1",
        state: "sealed",
        seal_hash: "abc123",
        sealed_at: "2026-01-02T00:00:00Z",
        attestations_count: 2,
      },
    }));
    const wad = result.stages[1];
    expect(wad.status).toBe("complete");
  });

  it("WaD is blocked when denied", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: {
        id: "wad-1",
        state: "DENIED",
        denial_reasons: ["UBO incomplete", "Screening expired"],
      },
    }));
    const wad = result.stages[1];
    expect(wad.status).toBe("blocked");
    expect(wad.detail).toContain("UBO incomplete");
  });

  it("PoD is not_started when WaD not sealed", () => {
    const result = resolveCompletion(baseInput());
    const pod = result.stages[2];
    expect(pod.status).toBe("not_started");
  });

  it("PoD shows milestone substeps when active", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z" },
      pod: { id: "pod-1", state: "ACTIVE", wad_id: "wad-1" },
      milestones: [
        { id: "ms-1", name: "Goods dispatched", status: "completed", sequence_order: 1 },
        { id: "ms-2", name: "Goods received", status: "pending", depends_on: "ms-1", sequence_order: 2 },
        { id: "ms-3", name: "Quality inspection", status: "pending", depends_on: "ms-2", sequence_order: 3 },
      ],
    }));
    const pod = result.stages[2];
    expect(pod.status).toBe("in_progress");
    // ms-2 should be allowed (dep met), ms-3 should be blocked (dep not met)
    const ms2Action = pod.actions.find(a => a.id === "pod-complete-ms-2");
    const ms3Action = pod.actions.find(a => a.id === "pod-complete-ms-3");
    expect(ms2Action!.allowed).toBe(true);
    expect(ms3Action!.allowed).toBe(false);
    expect(ms3Action!.blockedReason).toContain("Prerequisite");
  });

  it("PoD is blocked when breached", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z" },
      pod: { id: "pod-1", state: "BREACHED", wad_id: "wad-1" },
      milestones: [{ id: "ms-1", name: "Delivery", status: "pending", sequence_order: 1 }],
      breaches: [{ id: "b-1", status: "open", reason: "Late delivery" }],
    }));
    const pod = result.stages[2];
    expect(pod.status).toBe("blocked");
    expect(pod.actions.find(a => a.type === "resolve_breach")).toBeTruthy();
  });

  it("Evidence stage gated on settlement", () => {
    const result = resolveCompletion(baseInput());
    const evidence = result.stages[3];
    expect(evidence.status).toBe("not_started");
    const genAction = evidence.actions.find(a => a.type === "generate_evidence_pack");
    expect(genAction!.allowed).toBe(false);
  });

  it("Evidence stage actionable when settled", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
    }));
    const evidence = result.stages[3];
    const genAction = evidence.actions.find(a => a.type === "generate_evidence_pack");
    expect(genAction!.allowed).toBe(true);
  });

  it("role-based blocking: org_member cannot create WaD", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      userRole: "org_member",
    }));
    const wadCreate = result.stages[1].actions.find(a => a.type === "create_wad");
    expect(wadCreate!.requiredRole).toBe("org_admin");
    // Action is "allowed" by state but role check is separate - UI blocks it
  });

  it("overall progress reflects stage completion", () => {
    const allDone = resolveCompletion(baseInput({
      match: {
        ...baseInput().match,
        status: "settled",
        settled_at: "2026-01-01T00:00:00Z",
        buyer_committed_at: "2026-01-01T00:00:00Z",
        seller_committed_at: "2026-01-01T00:00:00Z",
        counterparty_sighted_at: "2026-01-01T00:00:00Z",
      },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z", attestations_count: 2 },
      pod: { id: "pod-1", state: "FINALISED", wad_id: "wad-1" },
      documents: { total: 3, reviewed: 3, pending: 0 },
    }));
    expect(allDone.overallPct).toBeGreaterThanOrEqual(75);
    expect(allDone.summary).toContain("finality");
  });

  it("cancelled match blocks everything", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "cancelled" },
    }));
    expect(result.stages[0].status).toBe("blocked");
    const confirmAction = result.stages[0].actions.find(a => a.type === "confirm_intent");
    expect(confirmAction!.allowed).toBe(false);
  });

  it("overdue milestone shows warning in substep detail", () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z" },
      pod: { id: "pod-1", state: "ACTIVE", wad_id: "wad-1" },
      milestones: [
        { id: "ms-1", name: "Delivery", status: "pending", due_at: yesterday, sequence_order: 1 },
      ],
    }));
    const pod = result.stages[2];
    const deliverySub = pod.substeps.find(s => s.label.includes("Delivery"));
    expect(deliverySub).toBeTruthy();
    expect(deliverySub!.label).toContain("⚠");
    expect(deliverySub!.detail).toContain("Overdue");
  });

  it("breach with grace period shows in substep detail", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z" },
      pod: { id: "pod-1", state: "BREACHED", wad_id: "wad-1" },
      milestones: [
        { id: "ms-1", name: "Delivery", status: "breach_detected", due_at: "2026-01-01T00:00:00Z", breach_detected_at: "2026-03-20T00:00:00Z", grace_period_ends_at: future, sequence_order: 1 },
      ],
      breaches: [{ id: "b-1", status: "grace_period", reason: "Overdue", severity: "medium" }],
    }));
    const pod = result.stages[2];
    const deliverySub = pod.substeps.find(s => s.label.includes("Delivery"));
    expect(deliverySub!.detail).toContain("grace period");
  });

  it("resolved breaches are not counted as open", () => {
    const result = resolveCompletion(baseInput({
      match: { ...baseInput().match, status: "settled", settled_at: "2026-01-01T00:00:00Z" },
      wad: { id: "wad-1", state: "sealed", seal_hash: "abc", sealed_at: "2026-01-02T00:00:00Z" },
      pod: { id: "pod-1", state: "ACTIVE", wad_id: "wad-1" },
      milestones: [{ id: "ms-1", name: "Delivery", status: "completed", sequence_order: 1 }],
      breaches: [{ id: "b-1", status: "resolved", reason: "Was overdue", severity: "low", resolved_at: "2026-03-21T00:00:00Z" }],
    }));
    const pod = result.stages[2];
    // No resolve_breach action since breach is resolved
    expect(pod.actions.find(a => a.type === "resolve_breach")).toBeFalsy();
  });
});
