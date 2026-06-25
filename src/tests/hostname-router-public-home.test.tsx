/**
 * Regression test for the live-domain homepage fix.
 *
 * Previously, visiting `www.izenzo.co.za` hard-redirected to the console host
 * (api.trade.izenzo.co.za), making the public homepage unreachable. This test
 * locks in that the public host now renders the app's own children at `/`
 * with no redirect side-effect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HostnameRouter } from "@/components/HostnameRouter";

const originalLocation = window.location;

function setHostname(hostname: string) {
  // jsdom location is read-only; redefine for the test.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      hostname,
      host: hostname,
      assign: vi.fn(),
      replace: vi.fn(),
    },
  });
}

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("HostnameRouter (public live domain)", () => {
  beforeEach(() => {
    setHostname("www.izenzo.co.za");
  });

  it("does NOT hard-redirect to the console host", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HostnameRouter>
          <div data-testid="public-home">PUBLIC HOMEPAGE</div>
        </HostnameRouter>
      </MemoryRouter>,
    );
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("renders the public homepage children at /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HostnameRouter>
          <div data-testid="public-home">PUBLIC HOMEPAGE</div>
        </HostnameRouter>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("public-home")).toBeInTheDocument();
  });
});

describe("HostnameRouter (apex izenzo.co.za)", () => {
  beforeEach(() => {
    setHostname("izenzo.co.za");
  });

  it("renders children, no console redirect", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HostnameRouter>
          <div data-testid="public-home">PUBLIC HOMEPAGE</div>
        </HostnameRouter>
      </MemoryRouter>,
    );
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("public-home")).toBeInTheDocument();
  });
});

describe("HostnameRouter (reserved marketplace host)", () => {
  beforeEach(() => {
    setHostname("trade.izenzo.co.za");
  });

  it("still hard-redirects to the console (unchanged behaviour)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HostnameRouter>
          <div data-testid="public-home">PUBLIC HOMEPAGE</div>
        </HostnameRouter>
      </MemoryRouter>,
    );
    expect(window.location.replace).toHaveBeenCalledWith(
      expect.stringContaining("api.trade.izenzo.co.za"),
    );
  });
});
