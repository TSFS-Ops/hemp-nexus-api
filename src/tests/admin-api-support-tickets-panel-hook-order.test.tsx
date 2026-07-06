/**
 * AdminApiSupportTicketsPanel — hook-order regression guard.
 *
 * Regression test for a Rules-of-Hooks violation where `useMemo` was
 * called AFTER a conditional early return (`if (!canRead) return ...`).
 * `canRead` is derived from `useAuth().roles`, which can change between
 * renders of the SAME mounted instance (e.g. roles resolving
 * asynchronously right after auth loads, or admin permissions changing
 * mid-session). A hook that is only called on some renders violates
 * React's Rules of Hooks and makes React throw "Rendered more/fewer
 * hooks than during the previous render" (or log an equivalent
 * hook-order error) instead of just cleanly re-rendering.
 *
 * This test exercises exactly that transition on both directions
 * (no-access -> access, and access -> no-access) on one mounted
 * instance, which is the narrowest reproduction of the original bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const state = vi.hoisted(() => ({
  roles: [] as string[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ roles: state.roles }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

import { AdminApiSupportTicketsPanel } from "@/components/admin/AdminApiSupportTicketsPanel";

const RESTRICTED_TEXT = /restricted to platform admins, API admins and auditors/i;
const HOOK_ORDER_PATTERN = /change in the order of Hooks|Rendered (more|fewer) hooks/i;

function hookOrderErrorWasLogged(errorSpy: ReturnType<typeof vi.spyOn>): boolean {
  return errorSpy.mock.calls.some((args) =>
    args.some((a) => typeof a === "string" && HOOK_ORDER_PATTERN.test(a)),
  );
}

describe("AdminApiSupportTicketsPanel — hook-order safety across canRead transitions", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.roles = [];
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("goes from restricted -> authorised on the same instance without a hook-order error", async () => {
    state.roles = [];
    const { rerender } = render(<AdminApiSupportTicketsPanel />);

    // Initial render: no read access at all.
    expect(screen.getByText(RESTRICTED_TEXT)).toBeInTheDocument();

    // Simulate roles resolving asynchronously (e.g. auth context finishing
    // its initial fetch) on the SAME mounted component instance. If
    // useMemo is ever skipped on one render and called on another, this
    // rerender throws instead of completing.
    state.roles = ["platform_admin"];
    rerender(<AdminApiSupportTicketsPanel />);

    await waitFor(() => {
      expect(screen.queryByText(RESTRICTED_TEXT)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Refresh/i })).toBeInTheDocument();

    expect(hookOrderErrorWasLogged(errorSpy)).toBe(false);
  });

  it("goes from authorised -> restricted on the same instance without a hook-order error", async () => {
    state.roles = ["auditor"];
    const { rerender } = render(<AdminApiSupportTicketsPanel />);
    expect(screen.getByRole("button", { name: /Refresh/i })).toBeInTheDocument();

    state.roles = [];
    rerender(<AdminApiSupportTicketsPanel />);

    await waitFor(() => {
      expect(screen.getByText(RESTRICTED_TEXT)).toBeInTheDocument();
    });

    expect(hookOrderErrorWasLogged(errorSpy)).toBe(false);
  });
});
