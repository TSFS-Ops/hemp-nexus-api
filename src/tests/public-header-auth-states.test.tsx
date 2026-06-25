/**
 * Regression test for the logged-in public-domain header behaviour.
 *
 * Client direction (2026-06-25): when an already-authenticated user lands
 * on www.izenzo.co.za, the header must:
 *   1. Wait for auth restore before rendering CTAs (no flash of Log In).
 *   2. Show a same-origin Dashboard / HQ CTA — never a cross-domain link
 *      to api.trade.izenzo.co.za, which has its own auth realm and would
 *      force re-login.
 *   3. Use role-aware labels: platform admins see "Go to HQ" → /hq/users,
 *      trade users see "Dashboard" → /dashboard.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicHeader } from "@/components/PublicHeader";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
const mockedUseAuth = vi.mocked(useAuth);

function renderHeader() {
  return render(
    <MemoryRouter>
      <PublicHeader />
    </MemoryRouter>,
  );
}

function authState(overrides: Partial<ReturnType<typeof useAuth>>) {
  return {
    user: null,
    session: null,
    isLoading: false,
    rolesLoaded: true,
    isAuthenticated: false,
    isPlatformAdmin: false,
    isOrgAdmin: false,
    isOrgMember: false,
    isAdmin: false,
    roles: [],
    signOut: vi.fn(),
    refreshSession: vi.fn(),
    suppressExpiry: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>;
}

describe("PublicHeader auth-state CTAs", () => {
  it("does not flash logged-out CTAs while auth is still loading", () => {
    mockedUseAuth.mockReturnValue(authState({ isLoading: true, rolesLoaded: false }));
    renderHeader();
    expect(screen.queryByText("Log In")).not.toBeInTheDocument();
    expect(screen.queryByText("Create Account")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to HQ")).not.toBeInTheDocument();
  });

  it("does not show Dashboard until role lookup resolves for an authed user", () => {
    mockedUseAuth.mockReturnValue(
      authState({ isAuthenticated: true, isLoading: false, rolesLoaded: false }),
    );
    renderHeader();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to HQ")).not.toBeInTheDocument();
  });

  it("shows Log In + Create Account when fully unauthenticated", () => {
    mockedUseAuth.mockReturnValue(authState({}));
    renderHeader();
    expect(screen.getAllByText("Log In").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Create Account").length).toBeGreaterThan(0);
  });

  it("shows a same-origin Dashboard link for an authed trade user", () => {
    mockedUseAuth.mockReturnValue(
      authState({ isAuthenticated: true, isPlatformAdmin: false }),
    );
    renderHeader();
    const links = screen.getAllByRole("link", { name: /Dashboard/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href).toBe("/dashboard");
      expect(href).not.toMatch(/^https?:\/\//);
      expect(href).not.toContain("api.trade.izenzo.co.za");
    }
  });

  it("shows a same-origin HQ link for an authed platform admin", () => {
    mockedUseAuth.mockReturnValue(
      authState({ isAuthenticated: true, isPlatformAdmin: true }),
    );
    renderHeader();
    const links = screen.getAllByRole("link", { name: /Go to HQ/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href).toBe("/hq/users");
      expect(href).not.toMatch(/^https?:\/\//);
    }
  });

  it("never renders a cross-domain api.trade.izenzo.co.za href", () => {
    for (const state of [
      authState({}),
      authState({ isAuthenticated: true }),
      authState({ isAuthenticated: true, isPlatformAdmin: true }),
    ]) {
      mockedUseAuth.mockReturnValue(state);
      const { container, unmount } = render(
        <MemoryRouter>
          <PublicHeader />
        </MemoryRouter>,
      );
      const hrefs = Array.from(container.querySelectorAll("a"))
        .map((a) => a.getAttribute("href") ?? "");
      for (const href of hrefs) {
        expect(href).not.toContain("api.trade.izenzo.co.za");
      }
      unmount();
    }
  });
});
