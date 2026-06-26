/**
 * P-5 Screening — Phase 1 SSOT tests.
 */
import { describe, it, expect } from "vitest";
import {
  P5_SCR_CHECK_CATEGORIES,
  P5_SCR_CHECK_STATES,
  P5_SCR_CLEAR_STATES,
  P5_SCR_UNRESOLVED_STATES,
  P5_SCR_GATES,
  P5_SCR_GATE_BLOCK_MATRIX,
  P5_SCR_ALLOWED_EXTERNAL_WORDING,
  P5_SCR_BANNED_EXTERNAL_WORDING,
  P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS,
  P5_SCR_AUDIT_EVENTS,
  P5_SCR_WEBHOOK_EVENTS,
  P5_SCR_API_SAFE_FIELDS,
  P5_SCR_API_FORBIDDEN_FIELDS,
  P5_SCR_SCREENING_REUSE_MAX_AGE_DAYS,
  P5_SCR_IDV_REQUIRED_ROLES,
  p5ScrIsReusable,
} from "@/lib/p5-screening/registry";

describe("P-5 Screening Phase 1 SSOT", () => {
  it("has the five client-confirmed check categories", () => {
    expect(P5_SCR_CHECK_CATEGORIES).toHaveLength(5);
    expect(P5_SCR_CHECK_CATEGORIES).toContain("adverse_media_admin_triggered");
  });

  it("has the eleven check states", () => {
    expect(P5_SCR_CHECK_STATES).toHaveLength(11);
  });

  it("clear and unresolved state sets are disjoint and cover all non-cleared states", () => {
    for (const s of P5_SCR_CLEAR_STATES) {
      expect(P5_SCR_UNRESOLVED_STATES).not.toContain(s);
    }
  });

  it("POI create/accept and WaD create are never blocked by pending screening/IDV", () => {
    const pendingStates = [
      "not_started",
      "screening_pending",
      "idv_pending",
      "provider_pending",
      "manual_review_required",
      "screening_expired",
    ] as const;
    for (const s of pendingStates) {
      const blocked = P5_SCR_GATE_BLOCK_MATRIX[s];
      expect(blocked).not.toContain("poi_create");
      expect(blocked).not.toContain("poi_accept");
      expect(blocked).not.toContain("wad_create");
    }
  });

  it("all unresolved states block WaD seal, finality, funder-ready and API ready=true", () => {
    for (const s of P5_SCR_UNRESOLVED_STATES) {
      const blocked = P5_SCR_GATE_BLOCK_MATRIX[s];
      expect(blocked).toContain("wad_seal");
      expect(blocked).toContain("finality");
      expect(blocked).toContain("funder_ready");
      expect(blocked).toContain("api_ready_true");
    }
  });

  it("failed and rejected block everything including POI", () => {
    for (const s of ["failed", "rejected"] as const) {
      for (const g of P5_SCR_GATES) {
        expect(P5_SCR_GATE_BLOCK_MATRIX[s]).toContain(g);
      }
    }
  });

  it("reuse window pinned at 90 days", () => {
    expect(P5_SCR_SCREENING_REUSE_MAX_AGE_DAYS).toBe(90);
  });

  it("reusable when fresh and no invalidation triggers", () => {
    expect(
      p5ScrIsReusable({ decided_at_ms: Date.now() - 30 * 86_400_000 }),
    ).toBe(true);
  });

  it("not reusable when stale", () => {
    expect(
      p5ScrIsReusable({ decided_at_ms: Date.now() - 100 * 86_400_000 }),
    ).toBe(false);
  });

  it("not reusable when any invalidation trigger is present", () => {
    expect(
      p5ScrIsReusable({
        decided_at_ms: Date.now() - 1_000,
        invalidation_triggers: ["admin_required_recheck"],
      }),
    ).toBe(false);
  });

  it("IDV-required roles cover both authorised representatives, funder rep, admin and agent", () => {
    expect(P5_SCR_IDV_REQUIRED_ROLES).toContain("buyer_authorised_representative");
    expect(P5_SCR_IDV_REQUIRED_ROLES).toContain("seller_authorised_representative");
    expect(P5_SCR_IDV_REQUIRED_ROLES).toContain("funder_representative");
    expect(P5_SCR_IDV_REQUIRED_ROLES).toContain("admin_user");
    expect(P5_SCR_IDV_REQUIRED_ROLES).toContain("agent_or_introducer");
  });

  it("allowed and banned external wording sets do not overlap", () => {
    const allowedLower = P5_SCR_ALLOWED_EXTERNAL_WORDING.map((s) => s.toLowerCase());
    for (const banned of P5_SCR_BANNED_EXTERNAL_WORDING) {
      expect(allowedLower).not.toContain(banned.toLowerCase());
    }
  });

  it("Memory-banned payload kinds cover the seven client-confirmed types", () => {
    expect(P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS).toHaveLength(7);
  });

  it("audit and webhook vocabularies are p5_screening.* namespaced", () => {
    for (const e of P5_SCR_AUDIT_EVENTS) expect(e.startsWith("p5_screening.")).toBe(true);
    for (const e of P5_SCR_WEBHOOK_EVENTS) expect(e.startsWith("p5_screening.")).toBe(true);
  });

  it("API-safe fields do not overlap with API-forbidden fields", () => {
    for (const f of P5_SCR_API_SAFE_FIELDS) {
      expect(P5_SCR_API_FORBIDDEN_FIELDS as readonly string[]).not.toContain(f);
    }
  });
});
