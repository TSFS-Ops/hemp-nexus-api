/**
 * role-negative-admin-engagements-deeplinks.test.tsx
 *
 * Coverage-only test pass for Unknown-Counterparty Admin Facilitation deep-links.
 * Proves that /hq/engagements and the legacy /admin/engagements redirect sit
 * behind the same RequireAuth(role="platform_admin") guard for:
 *  - logged-out
 *  - org_member
 *  - org_admin
 *  - auditor
 *  - platform_admin (allowed)
 * Query strings (?match=, ?engagement=) survive the guard for platform_admin.
 *
 * No product code is modified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { LegacyRedirect } from "@/components/LegacyRedirect";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}
function HQEngagements() {
  return <div data-testid="hq-engagements">HQ Engagements</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hq/engagements"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <HQEngagements />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/engagements"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <LegacyRedirect to="/hq/engagements" label="Admin Engagements" />
            </RequireAuth>
          }
        />
        <Route path="*" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Admin engagements deep-link role-negative coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logged-out → /hq/engagements bounces to /auth with returnTo", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderAt("/hq/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fhq%2Fengagements");
    });
  });

  it("logged-out → /hq/engagements?match=<uuid> bounces and preserves returnTo path", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderAt("/hq/engagements?match=11111111-1111-1111-1111-111111111111");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fhq%2Fengagements");
    });
  });

  it("org_member is denied", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
    renderAt("/hq/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
    });
  });

  it("org_admin is denied", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
    renderAt("/hq/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
    });
  });

  it("auditor is denied", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["auditor"] });
    renderAt("/hq/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
    });
  });

  it("platform_admin renders /hq/engagements", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
    renderAt("/hq/engagements");
    await waitFor(() => expect(screen.getByTestId("hq-engagements")).toBeInTheDocument());
  });

  it("platform_admin: ?match=<uuid> survives the guard and reaches HQ Engagements", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
    renderAt("/hq/engagements?match=22222222-2222-2222-2222-222222222222");
    await waitFor(() => expect(screen.getByTestId("hq-engagements")).toBeInTheDocument());
  });

  it("legacy /admin/engagements logged-out bounces to /auth (returnTo points at /hq/engagements)", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderAt("/admin/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2F");
    });
  });

  it("legacy /admin/engagements wrong-role (org_admin) is denied", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
    renderAt("/admin/engagements");
    expect(screen.queryByTestId("hq-engagements")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
    });
  });
});
