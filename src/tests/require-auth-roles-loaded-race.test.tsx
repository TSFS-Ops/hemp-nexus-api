/**
 * RequireAuth — roles-loaded race regression test.
 *
 * Prior bug: on hard reload, `isLoading` flipped to false before the async
 * `fetchRoles` resolved. RequireAuth saw roles=[] and bounced valid
 * platform_admins to /desk?denied=1.
 *
 * Fix: AuthContext exposes `rolesLoaded`. RequireAuth must render the
 * loader (NOT redirect) while authenticated and rolesLoaded=false.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";

import { useLocation } from "react-router-dom";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function Protected() {
  return <div>HQ_OK</div>;
}
function Desk() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  return <div>DESK_{params.get("denied") === "1" ? "DENIED" : "PLAIN"}</div>;
}


function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hq/*"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <Protected />
            </RequireAuth>
          }
        />
        <Route path="/desk" element={<Desk />} />
        <Route path="/auth" element={<div>AUTH_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth roles-loaded race", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("does NOT redirect platform_admin to /desk?denied=1 while rolesLoaded=false", () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      roles: [], // not yet fetched
      rolesLoaded: false,
    });
    renderAt("/hq/governance-records?sub=memory");
    expect(screen.queryByText("DESK_DENIED")).toBeNull();
    expect(screen.queryByText("HQ_OK")).toBeNull();
  });

  it("renders HQ once rolesLoaded=true with platform_admin role", () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      roles: ["platform_admin"],
      rolesLoaded: true,
    });
    renderAt("/hq/governance-records?sub=memory");
    expect(screen.getByText("HQ_OK")).toBeTruthy();
  });

  it("redirects authenticated non-admin to /desk?denied=1 only after roles resolved", () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      roles: ["org_member"],
      rolesLoaded: true,
    });
    renderAt("/hq/governance-records?sub=memory");
    expect(screen.getByText("DESK_DENIED")).toBeTruthy();
  });

  it("backward compat: missing rolesLoaded property is treated as loaded", () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      roles: ["platform_admin"],
      // rolesLoaded omitted (legacy mock)
    });
    renderAt("/hq/governance-records?sub=memory");
    expect(screen.getByText("HQ_OK")).toBeTruthy();
  });
});
