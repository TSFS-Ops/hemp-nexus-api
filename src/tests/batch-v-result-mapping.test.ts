/**
 * Batch V — Result mapping tests.
 *
 * Locks the raw-outcome → internal-status → user-wording table and the
 * final `unlocks_controlled_actions` combinator. Also proves the server
 * mirror has identical mapping shape.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  IDV_OUTCOME_MAP,
  resolveVerifyNowOutcome,
} from "@/lib/idv/result-mapping";

describe("Batch V — VerifyNow result mapping", () => {
  it.each([
    ["clear_match", "idv_completed", "Identity verification completed", true],
    ["possible_mismatch", "manual_review_required", "Manual review required", false],
    ["clear_mismatch", "manual_review_required", "Manual review required", false],
    ["not_found", "retry_required", "Retry required / Alternative document required", false],
    ["source_unavailable", "provider_pending", "Provider pending", false],
    ["timeout", "provider_pending", "Provider pending", false],
    ["provider_error", "provider_error", "Manual review required", false],
    ["unsupported_country", "provider_not_available", "Manual review required", false],
    ["unsupported_document_type", "provider_not_available", "Manual review required", false],
    ["blocked_id", "blocked_pending_admin_decision", "Manual review required", false],
    ["deceased", "blocked_pending_admin_decision", "Manual review required", false],
    ["suspected_fraud", "blocked_pending_admin_decision", "Manual review required", false],
  ] as const)(
    "raw=%s → internal=%s wording=%s may_unlock=%s",
    (raw, internal, wording, mayUnlock) => {
      const m = IDV_OUTCOME_MAP[raw];
      expect(m.internal_status).toBe(internal);
      expect(m.user_wording).toBe(wording);
      expect(m.may_unlock_controlled_actions).toBe(mayUnlock);
    },
  );

  it("clear_match on a full-IDV route unlocks controlled actions", () => {
    const r = resolveVerifyNowOutcome({ raw_outcome: "clear_match", route_can_unlock: true });
    expect(r.internal_status).toBe("idv_completed");
    expect(r.unlocks_controlled_actions).toBe(true);
  });

  it("clear_match on a supporting-only route does NOT unlock (downgrades)", () => {
    const r = resolveVerifyNowOutcome({ raw_outcome: "clear_match", route_can_unlock: false });
    expect(r.internal_status).toBe("manual_review_required");
    expect(r.unlocks_controlled_actions).toBe(false);
  });

  it("no outcome auto-rejects — mismatches route to manual review, not final rejection", () => {
    const r = resolveVerifyNowOutcome({ raw_outcome: "clear_mismatch", route_can_unlock: true });
    expect(r.internal_status).not.toBe("rejected" as never);
    expect(["manual_review_required", "blocked_pending_admin_decision"]).toContain(
      r.internal_status,
    );
  });

  it("server mirror mapping enumerates all raw outcomes", () => {
    const server = readFileSync(
      "supabase/functions/_shared/verifynow/result-mapping.ts",
      "utf8",
    );
    for (const raw of Object.keys(IDV_OUTCOME_MAP)) {
      expect(server).toContain(`${raw}:`);
    }
  });
});
