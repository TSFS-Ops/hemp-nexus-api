/**
 * Batch J — Anonymous route access E2E.
 *
 * Navigates to /welcome, /docs, /developer, /hq, and /governance as an
 * anonymous (logged-out) user and asserts:
 *
 *   /welcome      → self-wraps RequireAuth → redirects to /auth?returnTo=%2Fwelcome
 *   /docs         → PUBLIC, renders the docs public chrome (PublicHeader + DocH1)
 *   /developer    → RequireAuth → /auth?returnTo=%2Fdeveloper
 *   /hq           → RequireAuth role="platform_admin" → /auth?returnTo=%2Fhq
 *   /governance   → Navigate to /governance/triage → RequireAuth → /auth?returnTo=%2Fgovernance%2Ftriage
 *
 * Also source-pins App.tsx so the public/protected shape cannot drift silently:
 * public routes must NOT be wrapped in RequireAuth and protected routes MUST be.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import Welcome from "@/pages/Welcome";
import DocsIndex from "@/pages/docs/Index";

// ── Mocks ────────────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));
vi.mock("@/components/HostnameRouter", () => ({
  HostnameRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCrossDomainUrls: () => ({
    apiUrl: "https://api.example.test",
    deskUrl: "https://desk.example.test",
    authUrl: "/auth",
    homeUrl: "/",
  }),
}));

const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"] as const;

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function Protected({ id }: { id: string }) {
  return <div data-testid={id}>protected</div>;
}

function renderRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Mirrors src/App.tsx for the routes under test */}
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/docs" element={<DocsIndex />} />
        <Route
          path="/developer/*"
          element={
            <RequireAuth>
              <Protected id="developer-content" />
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
          path="/governance/triage"
          element={
            <RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk">
              <Protected id="governance-content" />
            </RequireAuth>
          }
        />
        <Route path="/governance" element={<Navigate to="/governance/triage" replace />} />
        <Route path="*" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Batch J — anonymous navigation to /welcome, /docs, /developer, /hq, /governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      user: null,
      roles: [],
      isPlatformAdmin: false,
      isOrgAdmin: false,
    });
  });

  it("/welcome — anonymous user is redirected to /auth?returnTo=%2Fwelcome (Welcome self-wraps RequireAuth)", async () => {
    renderRoutes("/welcome");
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fwelcome");
    });
    // No persona/marketing chrome from the protected Welcome page must leak.
    expect(screen.queryByText(/Commercial Trading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Developer & API Integration/i)).not.toBeInTheDocument();
  });

  it("/docs — anonymous user sees the public docs chrome (no redirect, no auth gate)", async () => {
    renderRoutes("/docs");
    // Public H1 from src/pages/docs/Index.tsx
    expect(await screen.findByRole("heading", { level: 1, name: /Izenzo Developer Docs/i })).toBeInTheDocument();
    // Never redirects to /auth
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("/developer — anonymous user is redirected to /auth?returnTo=%2Fdeveloper", async () => {
    renderRoutes("/developer");
    expect(screen.queryByTestId("developer-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fdeveloper");
    });
  });

  it("/hq — anonymous user is redirected to /auth?returnTo=%2Fhq (NOT to /desk?denied=1)", async () => {
    renderRoutes("/hq");
    expect(screen.queryByTestId("hq-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fhq");
      // denied=1 is reserved for authenticated-but-unauthorised; anonymous must
      // hit the sign-in funnel instead.
      expect(loc.textContent).not.toContain("denied=1");
    });
  });

  it("/governance — anonymous user follows the /triage redirect then lands on /auth", async () => {
    renderRoutes("/governance");
    expect(screen.queryByTestId("governance-content")).not.toBeInTheDocument();
    await waitFor(() => {
      const loc = screen.getByTestId("location");
      expect(loc.textContent).toContain("/auth");
      expect(loc.textContent).toContain("returnTo=%2Fgovernance%2Ftriage");
    });
  });

  // ── Source-pin App.tsx so the public/protected shape cannot drift ─────
  describe("App.tsx source pins (public vs protected)", () => {
    const appSrc = readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");

    it("/docs is mounted without a RequireAuth wrapper at the route layer", () => {
      expect(appSrc).toMatch(/path="\/docs"\s+element=\{<DocsIndex \/>\}/);
    });

    it("/welcome is mounted at the route layer (Welcome.tsx self-wraps RequireAuth)", () => {
      expect(appSrc).toMatch(/path="\/welcome"\s+element=\{<Welcome \/>\}/);
      const welcomeSrc = readFileSync(path.resolve(process.cwd(), "src/pages/Welcome.tsx"), "utf-8");
      expect(welcomeSrc).toContain("<RequireAuth>");
      expect(welcomeSrc).toMatch(/import\s+\{\s*RequireAuth\s*\}\s+from\s+"@\/components\/RequireAuth"/);
    });

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

    it("/governance redirects to /governance/triage which is RequireAuth-gated", () => {
      expect(appSrc).toMatch(
        /path="\/governance"\s+element=\{<Navigate to="\/governance\/triage" replace \/>\}/
      );
      expect(appSrc).toMatch(
        /path="\/governance\/triage"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/
      );
    });
  });
});
