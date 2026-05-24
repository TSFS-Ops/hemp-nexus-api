/**
 * governance-record-route-guard.test.tsx
 *
 * Defence-in-depth: /hq/governance-records is bounded by the same
 * RequireAuth role="platform_admin" guard as the rest of /hq.
 * Non-HQ users (org_admin, org_member, unauthenticated) must NEVER
 * render the Governance Records surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}
function GovernanceRecordsContent() {
  return <div data-testid="governance-records-content">Governance Records</div>;
}

function renderGuarded(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hq/:tab"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <GovernanceRecordsContent />
            </RequireAuth>
          }
        />
        <Route path="*" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Governance Records route guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("platform_admin can render Governance Records", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
    renderGuarded("/hq/governance-records");
    await waitFor(() => {
      expect(screen.getByTestId("governance-records-content")).toBeInTheDocument();
    });
  });

  it("org_admin is blocked and redirected to /desk?denied=1", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
    renderGuarded("/hq/governance-records");
    expect(screen.queryByTestId("governance-records-content")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
    });
  });

  it("org_member is blocked", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
    renderGuarded("/hq/governance-records");
    expect(screen.queryByTestId("governance-records-content")).not.toBeInTheDocument();
  });

  it("unauthenticated user is redirected to /auth with returnTo", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderGuarded("/hq/governance-records");
    expect(screen.queryByTestId("governance-records-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("/auth");
      expect(loc).toContain("returnTo=%2Fhq%2Fgovernance-records");
    });
  });
});
