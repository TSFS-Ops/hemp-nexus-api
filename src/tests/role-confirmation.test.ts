/**
 * D-03 Role inversion auto-fill / silent trade-side rewrite.
 *
 * T-03 regression test (pure-logic level): exercises the role-confirmation
 * helpers that the CounterpartySearch UI now depends on, and proves the
 * RPC-backed audit-write contract is correctly wired.
 *
 * UI cases 1-4 are implemented in CounterpartySearch via these helpers;
 * this test validates the gating logic and the audit payload shape that
 * the UI hands to record_role_confirmation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const rpc = vi.fn(async (_fn: string, _args: any) => ({
    data: "00000000-0000-0000-0000-00000000aud1",
    error: null,
  }));
  return { supabase: { rpc } };
});

import {
  inferUserSideFromParsedRole,
  detectSideConflict,
  recordRoleConfirmation,
  ROLE_CONFIRMATION_REQUIRED,
} from "@/lib/role-confirmation";
import { supabase } from "@/integrations/supabase/client";

beforeEach(() => {
  (supabase.rpc as any).mockClear();
});

describe("D-03 role-confirmation helpers", () => {
  it("inverts parsedQuery.role into the user's inferred side", () => {
    expect(inferUserSideFromParsedRole("buyer")).toBe("seller");
    expect(inferUserSideFromParsedRole("seller")).toBe("buyer");
    expect(inferUserSideFromParsedRole(null)).toBeNull();
    expect(inferUserSideFromParsedRole(undefined as any)).toBeNull();
  });

  it("Case 1: selected side === inferred side → no conflict, no modal", () => {
    // user selected 'buyer', query was 'sellers for cashew' (parsedRole=seller → inferred user=buyer)
    expect(detectSideConflict("buyer", "buyer")).toBe(false);
    expect(detectSideConflict("seller", "seller")).toBe(false);
  });

  it("Case 2: selected side !== inferred side → conflict, modal must block", () => {
    expect(detectSideConflict("buyer", "seller")).toBe(true);
    expect(detectSideConflict("seller", "buyer")).toBe(true);
  });

  it("does not flag conflict when one side is missing (cannot block on incomplete data)", () => {
    expect(detectSideConflict(null, "buyer")).toBe(false);
    expect(detectSideConflict("buyer", null)).toBe(false);
    expect(detectSideConflict(null, null)).toBe(false);
  });

  it("Case 3: user confirms inferred side → audit row written via RPC with confirmed=inferred", async () => {
    const id = await recordRoleConfirmation({
      originalSelectedSide: "buyer",
      inferredSide: "seller",
      confirmedSide: "seller", // user accepted the inferred side
      sourceComponent: "CounterpartySearch",
    });
    expect(id).toBe("00000000-0000-0000-0000-00000000aud1");
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("record_role_confirmation", {
      p_original_selected_side: "buyer",
      p_inferred_side: "seller",
      p_confirmed_side: "seller",
      p_match_id: null,
      p_draft_id: null,
      p_source_component: "CounterpartySearch",
    });
  });

  it("Case 4: user corrects to a different side → audit row written with corrected side", async () => {
    await recordRoleConfirmation({
      originalSelectedSide: "buyer",
      inferredSide: "seller",
      confirmedSide: "buyer", // user kept their original choice (correction = stay)
      sourceComponent: "CounterpartySearch",
    });
    const callArgs = (supabase.rpc as any).mock.calls[0][1];
    expect(callArgs.p_original_selected_side).toBe("buyer");
    expect(callArgs.p_inferred_side).toBe("seller");
    expect(callArgs.p_confirmed_side).toBe("buyer");
  });

  it("Case 5: production feature flag defaults safe (gated ON)", () => {
    // Default (no env override) must be true so the gate is active in prod.
    expect(ROLE_CONFIRMATION_REQUIRED).toBe(true);
  });

  it("propagates RPC errors instead of silently swallowing them (Zero Swallowed Errors)", async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: new Error("AUTH_REQUIRED") });
    await expect(
      recordRoleConfirmation({
        originalSelectedSide: "buyer",
        inferredSide: "seller",
        confirmedSide: "seller",
      }),
    ).rejects.toThrow("AUTH_REQUIRED");
  });
});
