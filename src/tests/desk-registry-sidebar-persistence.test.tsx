/**
 * Verifies that /desk/registry is mounted inside the DeskLayout (which renders
 * the persistent Trade Desk sidebar), and that the sidebar therefore stays
 * visible on direct navigation and on refresh (SPA fallback re-mounts the
 * same router entry, so mounting at the deep path is equivalent).
 *
 * Strategy:
 *  1. Source-pin Desk.tsx so the `registry` route remains nested inside the
 *     padded `path="*"` block whose element is wrapped in <DeskLayout>.
 *  2. Source-pin DeskSidebar.tsx so the Company Register nav points at
 *     /desk/registry (not /registry — which would escape the Desk shell).
 *  3. Render the same DeskLayout + nested Routes mirror under a MemoryRouter
 *     started directly at /desk/registry (simulating a refresh / deep link)
 *     and assert both the sidebar landmark and the registry content render.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Stub heavy DeskSidebar dependencies so we can render the real layout.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "tester@example.com" }, signOut: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));
vi.mock("@/hooks/use-user-org", () => ({ useUserOrg: () => null }));
vi.mock("@/components/layout/ContextSwitcher", () => ({
  ContextSwitcher: () => <div data-testid="ctx-switcher" />,
}));
vi.mock("@/components/notifications/SidebarNotificationItem", () => ({
  SidebarNotificationItem: () => <div data-testid="sidebar-notifications" />,
}));
vi.mock("@/components/desk/ActiveOrgIndicator", () => ({
  ActiveOrgIndicator: () => <div data-testid="active-org" />,
}));
vi.mock("@/components/desk/MobileBottomNav", () => ({
  MobileBottomNav: () => <div data-testid="mobile-bottom-nav" />,
}));
vi.mock("@/pages/registry/Landing", () => ({
  default: () => <div data-testid="registry-landing">Business Registry</div>,
}));

import { DeskLayout } from "@/components/desk/DeskLayout";
import RegistryLanding from "@/pages/registry/Landing";

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route
          path="/desk/*"
          element={
            <DeskLayout>
              <Routes>
                <Route path="registry" element={<RegistryLanding />} />
              </Routes>
            </DeskLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Trade Desk sidebar persists on /desk/registry", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const deskSrc = readFileSync(path.join(repoRoot, "src/pages/Desk.tsx"), "utf8");
  const sidebarSrc = readFileSync(
    path.join(repoRoot, "src/components/desk/DeskSidebar.tsx"),
    "utf8",
  );

  it("source-pins the registry route inside the DeskLayout-wrapped block", () => {
    // The `path="*"` element wraps children in <DeskLayout>; the registry route
    // must live inside that block, not as a sibling full-bleed route.
    const wildcardBlockStart = deskSrc.indexOf('path="*"');
    const layoutOpen = deskSrc.indexOf("<DeskLayout>", wildcardBlockStart);
    const layoutClose = deskSrc.indexOf("</DeskLayout>", layoutOpen);
    expect(wildcardBlockStart).toBeGreaterThan(-1);
    expect(layoutOpen).toBeGreaterThan(wildcardBlockStart);
    expect(layoutClose).toBeGreaterThan(layoutOpen);

    const registryRouteIdx = deskSrc.indexOf('path="registry"');
    expect(registryRouteIdx).toBeGreaterThan(layoutOpen);
    expect(registryRouteIdx).toBeLessThan(layoutClose);
  });

  it("source-pins the sidebar Company Register link to /desk/registry", () => {
    expect(sidebarSrc).toContain('to: "/desk/registry"');
    // Guard against regressing to the bare /registry path which would unmount
    // the Desk shell and hide the sidebar.
    expect(sidebarSrc).not.toMatch(/to:\s*"\/registry"/);
  });

  it("renders the Desk sidebar alongside registry content on direct navigation", () => {
    renderAt("/desk/registry");
    expect(screen.getByText("Izenzo")).toBeInTheDocument();
    expect(screen.getByText("Trade Desk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Company Register/i })).toBeInTheDocument();
    expect(screen.getByTestId("registry-landing")).toBeInTheDocument();
  });

  it("renders the Desk sidebar on a simulated refresh of /desk/registry", () => {
    // SPA fallback serves index.html and the router re-mounts at the same
    // deep path; remounting the tree here is the functional equivalent.
    const { unmount } = renderAt("/desk/registry");
    unmount();
    renderAt("/desk/registry");
    expect(screen.getByText("Izenzo")).toBeInTheDocument();
    expect(screen.getByTestId("registry-landing")).toBeInTheDocument();
  });
});
