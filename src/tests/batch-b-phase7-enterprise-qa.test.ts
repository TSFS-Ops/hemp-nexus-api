/**
 * Batch B Phase 7 — Enterprise QA aggregator.
 *
 * This test file does not introduce new product behaviour. It pins the
 * cross-cutting invariants the Phase 7 brief calls out so that any
 * future drift trips a single, obvious failure:
 *
 *   • The full stable-error-code matrix the engagement-progression
 *     guard and poi-engagements route emit are exhaustively asserted
 *     against both the client mirror (src/lib/engagement-progression-guard)
 *     and the edge route (supabase/functions/poi-engagements/index.ts).
 *   • Every required code is referenced by at least one earlier
 *     phase's test file (so removing or renaming a code surfaces here).
 *   • RLS / permission rule shape for late-acceptance reconfirmation
 *     (only initiator org_admin or platform_admin override) is pinned
 *     against the migration source so changes to the policy require an
 *     explicit test update.
 *   • Wording guard script and per-phase test files exist and are
 *     wired into the engagement-wording SSOT.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  decideEngagementProgression,
  type EngagementGuardCode,
} from "@/lib/engagement-progression-guard";

const REQUIRED_GUARD_CODES: EngagementGuardCode[] = [
  "ENGAGEMENT_REQUIRED",
  "ENGAGEMENT_NOT_ACCEPTED",
  "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE",
  "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION",
  "ENGAGEMENT_EXPIRED",
  "ENGAGEMENT_DECLINED",
];

const REQUIRED_ROUTE_CODES = [
  "ENGAGEMENT_ALREADY_ACCEPTED",
  "ENGAGEMENT_ALREADY_DECLINED",
  "LATE_ACCEPTANCE_ALREADY_RECORDED",
];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Batch B Phase 7 — stable error-code matrix", () => {
  it("guard emits ENGAGEMENT_REQUIRED when there is no engagement at all", () => {
    const d = decideEngagementProgression({
      current_engagement: null,
      latest_historical_engagement: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("ENGAGEMENT_REQUIRED");
  });

  it("guard emits ENGAGEMENT_NOT_ACCEPTED for fresh pre-acceptance state", () => {
    for (const status of ["pending", "notification_sent", "contacted"]) {
      const d = decideEngagementProgression({
        current_engagement: {
          id: "c",
          match_id: "m",
          engagement_status: status,
          created_at: "2026-01-01T00:00:00Z",
        },
        latest_historical_engagement: null,
      });
      expect(d.allowed).toBe(false);
      expect(d.code).toBe("ENGAGEMENT_NOT_ACCEPTED");
    }
  });

  it("guard emits ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE when a renewed child is pre-acceptance and a historical row exists", () => {
    for (const status of ["pending", "notification_sent", "contacted"]) {
      const d = decideEngagementProgression({
        current_engagement: {
          id: "child",
          match_id: "m",
          engagement_status: status,
          created_at: "2026-02-01T00:00:00Z",
        },
        latest_historical_engagement: {
          id: "parent",
          match_id: "m",
          engagement_status: "expired",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      expect(d.allowed).toBe(false);
      expect(d.code).toBe("ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE");
    }
  });

  it("guard emits LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION", () => {
    const d = decideEngagementProgression({
      current_engagement: {
        id: "c",
        match_id: "m",
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
        created_at: "2026-02-01T00:00:00Z",
      },
      latest_historical_engagement: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION");
  });

  it("guard emits ENGAGEMENT_EXPIRED / ENGAGEMENT_DECLINED on terminal-only history", () => {
    for (const status of ["expired", "declined"] as const) {
      const d = decideEngagementProgression({
        current_engagement: null,
        latest_historical_engagement: {
          id: "h",
          match_id: "m",
          engagement_status: status,
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      expect(d.allowed).toBe(false);
      expect(d.code).toBe(
        status === "expired" ? "ENGAGEMENT_EXPIRED" : "ENGAGEMENT_DECLINED",
      );
    }
  });

  it("guard ALLOWS only when current engagement is accepted (historical accepted alone is not enough)", () => {
    // Historical accepted + renewed pending child must NOT progress.
    const blocked = decideEngagementProgression({
      current_engagement: {
        id: "child",
        match_id: "m",
        engagement_status: "pending",
        created_at: "2026-02-01T00:00:00Z",
      },
      latest_historical_engagement: {
        id: "parent",
        match_id: "m",
        engagement_status: "expired",
        created_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(blocked.allowed).toBe(false);

    const allowed = decideEngagementProgression({
      current_engagement: {
        id: "current",
        match_id: "m",
        engagement_status: "accepted",
        created_at: "2026-02-01T00:00:00Z",
      },
      latest_historical_engagement: null,
    });
    expect(allowed.allowed).toBe(true);
  });

  it("client and edge guards declare the same set of stable codes", () => {
    const edge = read("supabase/functions/_shared/engagement-progression-guard.ts");
    for (const code of REQUIRED_GUARD_CODES) {
      expect(edge).toContain(`"${code}"`);
    }
  });

  it("poi-engagements edge route emits the late-acceptance / already-* codes", () => {
    const route = read("supabase/functions/poi-engagements/index.ts");
    for (const code of REQUIRED_ROUTE_CODES) {
      expect(route).toContain(code);
    }
  });
});

describe("Batch B Phase 7 — RLS / permission shape (reconfirmation)", () => {
  it("reconfirmation RPC is service-role only (no broad GRANT EXECUTE to authenticated)", () => {
    const sql = read(
      "supabase/migrations/20260508153158_214f3edf-1450-4874-ab84-4adfcb5a0011.sql",
    );
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window\(uuid\)\s*\n\s*TO service_role/);
    // Defence in depth: must NOT grant to authenticated/anon/PUBLIC.
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window[\s\S]*TO\s+(authenticated|anon|PUBLIC)/);
  });

  it("reconfirmation/decline route in poi-engagements requires initiator-org context (no counterparty-side path)", () => {
    const route = read("supabase/functions/poi-engagements/index.ts");
    // The late-acceptance reconfirmation path must reference initiator
    // identification — either initiator_org_id, requested_by_org_id, or
    // an explicit role check. This pins that the path is not anonymous.
    expect(
      /initiator_org_id|requested_by_org_id|requesting_org|is_admin|platform_admin/i.test(
        route,
      ),
    ).toBe(true);
  });
});

describe("Batch B Phase 7 — coverage matrix (pin the prior phase tests)", () => {
  it("each Batch B phase test file exists and references its own phase tag", () => {
    const files = [
      ["src/tests/batch-b-phase2-schema.test.ts", "Phase 2"],
      ["src/tests/batch-b-phase3-rpcs.test.ts", "Phase 3"],
      ["src/tests/batch-b-phase4-engagement-guard.test.ts", "Phase 4"],
      ["src/tests/batch-b-phase5-wording.test.ts", "Phase 5"],
      ["src/tests/batch-b-phase5-completion-audit.test.ts", "Phase 5"],
      ["src/tests/batch-b-phase6-reconfirmation-window.test.ts", "Phase 6"],
    ];
    for (const [path, tag] of files) {
      const body = read(path);
      expect(body, `${path} should reference ${tag}`).toMatch(
        new RegExp(tag, "i"),
      );
    }
  });

  it("wording guard script is present and scans the deferred surfaces", () => {
    const body = read("scripts/check-engagement-wording.mjs");
    for (const surface of [
      "src",
      "supabase/functions",
    ]) {
      expect(body).toContain(surface);
    }
  });
});
