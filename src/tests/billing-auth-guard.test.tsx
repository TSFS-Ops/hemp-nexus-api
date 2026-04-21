/**
 * billing-auth-guard.test.tsx
 *
 * Proves that the /billing route redirects unauthenticated users to /auth.
 * We mock AuthContext to simulate "no session" and assert the navigate call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";

// ── Mock AuthContext ────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Mock sonner (toast) so it doesn't blow up ──────────────────────
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

// ── Helper: capture what route we land on ──────────────────────────
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

// ── Fake billing content (should never render when unauthed) ───────
function BillingContent() {
  return <div data-testid="billing-content">Billing Page</div>;
}

describe("Billing auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to /auth with returnTo=/billing", async () => {
    // Simulate: auth finished loading, user is NOT authenticated
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      roles: [],
      user: null,
      session: null,
    });

    render(
      <MemoryRouter initialEntries={["/billing"]}>
        <Routes>
          <Route
            path="/billing"
            element={
              <RequireAuth>
                <BillingContent />
              </RequireAuth>
            }
          />
          {/* Catch-all so we can see where the redirect lands */}
          <Route path="*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    // The billing content must NOT be rendered
    expect(screen.queryByTestId("billing-content")).not.toBeInTheDocument();

    // RequireAuth fires a navigate() via useEffect - wait for it
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fbilling");
    });
  });

  it("renders billing content for authenticated users", async () => {
    // Simulate: auth finished loading, user IS authenticated
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      roles: ["org_member"],
      user: { id: "test-user-id" },
      session: { access_token: "fake" },
    });

    render(
      <MemoryRouter initialEntries={["/billing"]}>
        <Routes>
          <Route
            path="/billing"
            element={
              <RequireAuth>
                <BillingContent />
              </RequireAuth>
            }
          />
          <Route path="*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    // Billing content MUST render
    await waitFor(() => {
      expect(screen.getByTestId("billing-content")).toBeInTheDocument();
    });
    expect(screen.getByText("Billing Page")).toBeInTheDocument();
  });

  it("shows loader while auth is still loading", () => {
    mockUseAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      roles: [],
      user: null,
      session: null,
    });

    render(
      <MemoryRouter initialEntries={["/billing"]}>
        <Routes>
          <Route
            path="/billing"
            element={
              <RequireAuth>
                <BillingContent />
              </RequireAuth>
            }
          />
          <Route path="*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    // Billing content must NOT render while loading
    expect(screen.queryByTestId("billing-content")).not.toBeInTheDocument();
    // Should not have redirected either
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });
});
