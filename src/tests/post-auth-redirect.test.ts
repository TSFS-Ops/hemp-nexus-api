/**
 * Regression tests for the post-sign-in destination policy.
 *
 * Locks the live-domain fix: www.izenzo.co.za must land users on `/` after a
 * normal sign-in, must honour intentional protected `returnTo` deep links,
 * must reject external/malformed/stale values, and must still route platform
 * admins to /hq/users.
 */
import { describe, it, expect } from "vitest";
import {
  PROTECTED_RETURN_PREFIXES,
  resolvePostAuthDestination,
  resolveProtectedReturnTo,
} from "@/lib/post-auth-redirect";

describe("resolveProtectedReturnTo (allow-list)", () => {
  it("accepts a protected workspace path when intentional", () => {
    expect(resolveProtectedReturnTo("/desk/discover", true)).toBe("/desk/discover");
    expect(resolveProtectedReturnTo("/hq/users", true)).toBe("/hq/users");
    expect(resolveProtectedReturnTo("/admin/registry", true)).toBe("/admin/registry");
  });

  it("rejects stale / non-intentional returnTo even when path is valid", () => {
    expect(resolveProtectedReturnTo("/desk", false)).toBeNull();
  });

  it("rejects the bare home path", () => {
    expect(resolveProtectedReturnTo("/", true)).toBeNull();
  });

  it("rejects the legacy /dashboard default", () => {
    expect(resolveProtectedReturnTo("/dashboard", true)).toBeNull();
  });

  it("rejects /auth loops", () => {
    expect(resolveProtectedReturnTo("/auth", true)).toBeNull();
    expect(resolveProtectedReturnTo("/auth?returnTo=/", true)).toBeNull();
  });

  it("rejects external URLs", () => {
    expect(resolveProtectedReturnTo("https://evil.example.com/desk", true)).toBeNull();
    expect(resolveProtectedReturnTo("//evil.example.com/desk", true)).toBeNull();
    expect(resolveProtectedReturnTo("http:/desk", true)).toBeNull();
  });

  it("rejects malformed / dangerous values", () => {
    expect(resolveProtectedReturnTo("javascript:alert(1)", true)).toBeNull();
    expect(resolveProtectedReturnTo("/\\evil", true)).toBeNull();
    expect(resolveProtectedReturnTo("/desk\n/x", true)).toBeNull();
    expect(resolveProtectedReturnTo("%2F%2Fevil.example.com", true)).toBeNull();
  });

  it("rejects non-allow-listed internal paths (e.g. random public pages)", () => {
    expect(resolveProtectedReturnTo("/pricing", true)).toBeNull();
    expect(resolveProtectedReturnTo("/docs/anything", true)).toBeNull();
    expect(resolveProtectedReturnTo("/trust", true)).toBeNull();
  });

  it("preserves query string on accepted returnTo", () => {
    expect(resolveProtectedReturnTo("/desk/match/abc?tab=evidence", true)).toBe(
      "/desk/match/abc?tab=evidence",
    );
  });

  it("PROTECTED_RETURN_PREFIXES is non-empty and contains workspace surfaces", () => {
    expect(PROTECTED_RETURN_PREFIXES).toContain("/desk");
    expect(PROTECTED_RETURN_PREFIXES).toContain("/hq");
    expect(PROTECTED_RETURN_PREFIXES).toContain("/admin");
    expect(PROTECTED_RETURN_PREFIXES.length).toBeGreaterThan(3);
  });
});

describe("resolvePostAuthDestination", () => {
  const base = {
    isPlatformAdmin: false,
    persona: "trade" as const,
    rawReturnTo: null,
    returnToIsIntentional: false,
    hasPreAuthJourney: false,
  };

  it("platform admin → /hq/users regardless of returnTo", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: true,
        rawReturnTo: "/desk/discover",
        returnToIsIntentional: true,
      }),
    ).toBe("/hq/users");
  });

  it("trade persona, no returnTo, no pre-auth → / (public home)", () => {
    expect(resolvePostAuthDestination(base)).toBe("/");
  });

  it("trade persona, intentional protected returnTo → that path with resume=1", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        rawReturnTo: "/desk/billing",
        returnToIsIntentional: true,
      }),
    ).toBe("/desk/billing?resume=1");
  });

  it("trade persona, stale returnTo → ignored, fallback to /", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        rawReturnTo: "/desk/billing",
        returnToIsIntentional: false,
      }),
    ).toBe("/");
  });

  it("trade persona, external returnTo → ignored, fallback to /", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        rawReturnTo: "https://evil.example.com/desk",
        returnToIsIntentional: true,
      }),
    ).toBe("/");
  });

  it("trade persona, generic returnTo=/ from Landing → ignored, fallback to /", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        rawReturnTo: "/",
        returnToIsIntentional: true,
      }),
    ).toBe("/");
  });

  it("trade persona with explicit pre-auth journey → resumes into /desk", () => {
    expect(
      resolvePostAuthDestination({ ...base, hasPreAuthJourney: true }),
    ).toBe("/desk?resume=1");
  });

  it("missing persona → /welcome (persona picker)", () => {
    expect(resolvePostAuthDestination({ ...base, persona: null })).toBe("/welcome");
  });

  it("developer persona → /developers/keys", () => {
    expect(resolvePostAuthDestination({ ...base, persona: "developer" })).toBe(
      "/developers/keys",
    );
  });

  it("governance persona → /governance/triage", () => {
    expect(resolvePostAuthDestination({ ...base, persona: "governance" })).toBe(
      "/governance/triage",
    );
  });
});
