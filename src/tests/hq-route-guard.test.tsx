/**
 * hq-route-guard.test.tsx
 *
 * Defence-in-depth proof for /hq and /hq/:tab:
 *  - unauthenticated users are bounced to /auth with returnTo
 *  - org_admin / org_member are bounced to /desk?denied=1
 *  - platform_admin can render HQ content
 *  - legacy /admin redirects land behind the same guard
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
function HQContent() {
  return <div data-testid="hq-content">HQ Console</div>;
}

function renderHQ(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirror App.tsx: route-level guard wrapping HQ */}
        <Route
          path="/hq"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <HQContent />
            </RequireAuth>
          }
        />
        <Route
          path="/hq/:tab"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <HQContent />
            </RequireAuth>
          }
        />
        {/* Legacy redirect, mirrors App.tsx LegacyRedirect behaviour */}
        <Route path="/admin" element={<Navigate to="/hq/users" replace />} />
        <Route path="/admin/users" element={<Navigate to="/hq/users" replace />} />
        <Route path="*" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("HQ route guard (defence-in-depth)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects unauthenticated users from /hq to /auth?returnTo=/hq", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderHQ("/hq");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fhq");
    });
  });

  it("blocks org_admin from /hq and redirects to /desk?denied=1", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
    renderHQ("/hq");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toBe("/desk?denied=1");
    });
  });

  it("blocks org_member from /hq/users and redirects to /desk?denied=1", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
    renderHQ("/hq/users");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toBe("/desk?denied=1");
    });
  });

  it("allows platform_admin to render /hq content", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
    renderHQ("/hq");
    await waitFor(() => {
      expect(screen.getByTestId("hq-content")).toBeInTheDocument();
    });
  });

  it("allows platform_admin to render /hq/:tab content", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
    renderHQ("/hq/users");
    await waitFor(() => {
      expect(screen.getByTestId("hq-content")).toBeInTheDocument();
    });
  });

  it("legacy /admin redirect lands behind the HQ guard (org_admin → /desk?denied=1)", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
    renderHQ("/admin");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toBe("/desk?denied=1");
    });
  });

  it("legacy /admin/users redirect lands behind the HQ guard (unauthed → /auth)", async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
    renderHQ("/admin/users");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fhq%2Fusers");
    });
  });
});
