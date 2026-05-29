/**
 * UI-008 / SEC-003 — Route protection coverage.
 *
 * Source-pins App.tsx route guards and verifies RequireAuth redirect behaviour
 * for protected product routes (/desk/*), the developer surface (/developer/*),
 * the governance console (/governance/*), and the platform admin console (/hq/*).
 *
 * Out of scope for these tests: business logic, role definitions, or backend RLS.
 * We only assert that the documented redirect shape is preserved:
 *   - unauthenticated → /auth?returnTo=<path>
 *   - authenticated but insufficient role → <fallback>?denied=1
 */

import { readFileSync } from "node:fs";
import path from "node:path";
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
function Protected({ id }: { id: string }) {
  return <div data-testid={id}>protected</div>;
}

const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"] as const;

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirror of the privileged routes in src/App.tsx */}
        {/* /desk/* renders LocationDisplay alongside the protected marker so
            tests can read the denied=1 query string after a role redirect. */}
        <Route
          path="/desk/*"
          element={
            <RequireAuth>
              <>
                <Protected id="desk-content" />
                <LocationDisplay />
              </>
            </RequireAuth>
          }
        />
        <Route
          path="/developer/*"
          element={
            <RequireAuth role={["platform_admin", "org_admin"]} fallbackRoute="/desk">
              <Protected id="developer-content" />
            </RequireAuth>
          }
        />
        <Route
          path="/governance/triage"
          element={
            <RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk">
              <Protected id="governance-content" />
            </RequireAuth>
          }
        />
        <Route
          path="/hq"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <Protected id="hq-content" />
            </RequireAuth>
          }
        />
        <Route
          path="/hq/:tab"
          element={
            <RequireAuth role="platform_admin" fallbackRoute="/desk">
              <Protected id="hq-content" />
            </RequireAuth>
          }
        />
        <Route path="*" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("UI-008 / SEC-003 — route protection", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("logged-out users → /auth?returnTo=<path>", () => {
    it("protected product route /desk/match/abc-123", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
      renderApp("/desk/match/abc-123");
      expect(screen.queryByTestId("desk-content")).not.toBeInTheDocument();
      await waitFor(() => {
        const loc = screen.getByTestId("location");
        expect(loc.textContent).toContain("/auth");
        expect(loc.textContent).toContain("returnTo=%2Fdesk%2Fmatch%2Fabc-123");
      });
    });

    it("admin route /hq/users", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
      renderApp("/hq/users");
      await waitFor(() => {
        const loc = screen.getByTestId("location");
        expect(loc.textContent).toContain("/auth");
        expect(loc.textContent).toContain("returnTo=%2Fhq%2Fusers");
      });
    });

    it("developer surface /developer/keys", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
      renderApp("/developer/keys");
      await waitFor(() => {
        const loc = screen.getByTestId("location");
        expect(loc.textContent).toContain("/auth");
        expect(loc.textContent).toContain("returnTo=%2Fdeveloper%2Fkeys");
      });
    });

    it("governance console /governance/triage", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, roles: [] });
      renderApp("/governance/triage");
      await waitFor(() => {
        const loc = screen.getByTestId("location");
        expect(loc.textContent).toContain("/auth");
        expect(loc.textContent).toContain("returnTo=%2Fgovernance%2Ftriage");
      });
    });
  });

  describe("authenticated but insufficient role → fallback?denied=1", () => {
    it("org_member is blocked from /hq/users", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
      renderApp("/hq/users");
      expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
      });
    });

    it("org_admin is blocked from /hq (platform_admin only)", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_admin"] });
      renderApp("/hq");
      expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
      });
    });

    it("authenticated non-admin (auditor only) is blocked from /hq", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["auditor"] });
      renderApp("/hq");
      await waitFor(() => {
        expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
      });
    });

    it("org_member is blocked from /governance/triage", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
      renderApp("/governance/triage");
      await waitFor(() => {
        expect(screen.getByTestId("location").textContent).toBe("/desk?denied=1");
      });
    });
  });

  describe("authorised access renders content", () => {
    it("platform_admin renders /hq", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["platform_admin"] });
      renderApp("/hq");
      await waitFor(() => expect(screen.getByTestId("hq-content")).toBeInTheDocument());
    });

    it("any authenticated user renders /desk", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
      renderApp("/desk");
      await waitFor(() => expect(screen.getByTestId("desk-content")).toBeInTheDocument());
    });

    it("any authenticated user renders /developer/*", async () => {
      mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, roles: ["org_member"] });
      renderApp("/developer/keys");
      await waitFor(() => expect(screen.getByTestId("developer-content")).toBeInTheDocument());
    });
  });

  // ── Source-pin: ensure App.tsx still wraps every privileged route ─────
  describe("App.tsx source pins", () => {
    const appSrc = readFileSync(
      path.resolve(process.cwd(), "src/App.tsx"),
      "utf-8"
    );

    it("/developer/* is wrapped in RequireAuth", () => {
      expect(appSrc).toMatch(
        /path="\/developer\/\*"\s+element=\{<RequireAuth><DeveloperCenter \/><\/RequireAuth>\}/
      );
    });

    it("/hq is wrapped in RequireAuth role=\"platform_admin\"", () => {
      expect(appSrc).toMatch(
        /path="\/hq"\s+element=\{<RequireAuth role="platform_admin"[^}]*<HQ \/>/
      );
    });

    it("/hq/:tab is wrapped in RequireAuth role=\"platform_admin\"", () => {
      expect(appSrc).toMatch(
        /path="\/hq\/:tab"\s+element=\{<RequireAuth role="platform_admin"[^}]*<HQ \/>/
      );
    });

    it("governance routes use the GOVERNANCE_ROLES set", () => {
      expect(appSrc).toContain('GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"]');
      expect(appSrc).toMatch(/path="\/governance\/triage"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/);
    });

    it("/desk/* mounts the Desk shell which self-wraps in RequireAuth", () => {
      expect(appSrc).toMatch(/path="\/desk\/\*"\s+element=\{<Desk \/>\}/);
      const deskSrc = readFileSync(
        path.resolve(process.cwd(), "src/pages/Desk.tsx"),
        "utf-8"
      );
      // UI-008: the legacy "show Landing to guests" bypass must be gone, so
      // RequireAuth's /auth?returnTo=<path> redirect runs uniformly.
      expect(deskSrc).not.toMatch(/return <Landing \/>/);
      expect(deskSrc).toMatch(/<RequireAuth>/);
    });
  });

  // ── /auth shows the returnTo notice ───────────────────────────────────
  it("/auth source carries the returnTo sign-in notice", () => {
    const authSrc = readFileSync(
      path.resolve(process.cwd(), "src/pages/Auth.tsx"),
      "utf-8"
    );
    expect(authSrc).toContain('searchParams.get("returnTo")');
    expect(authSrc).toContain("Sign in to continue");
  });

  // ── /desk surfaces the denied=1 banner ───────────────────────────────
  it("Desk overview surfaces a denied=1 access notice", () => {
    const deskSrc = readFileSync(
      path.resolve(process.cwd(), "src/pages/Desk.tsx"),
      "utf-8"
    );
    expect(deskSrc).toContain("DeskDeniedBanner");
    expect(deskSrc).toContain('params.get("denied") === "1"');
    expect(deskSrc).toContain("You don't have access to that area.");
  });
});
