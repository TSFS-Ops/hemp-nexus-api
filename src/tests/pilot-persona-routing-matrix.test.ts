/**
 * Pilot Persona Routing Matrix
 * ----------------------------
 * Locks the post-sign-in landing behaviour for the six named pilot accounts
 * scoped in the Full Pilot Persona Routing & Access-Consistency Audit.
 *
 * This is a PURE-FUNCTION harness against `resolvePostAuthDestination`. It
 * does NOT hit Supabase, does NOT log in real users, and does NOT modify
 * backend state. Real database-backed membership resolution is exercised by
 * the browser walkthrough; this suite proves the branching logic is stable
 * regardless of role composition, returnTo, persona and pre-auth journey.
 */
import { describe, it, expect } from "vitest";
import { resolvePostAuthDestination } from "@/lib/post-auth-redirect";

type PilotAccount = {
  label: string;
  email: string;
  isPlatformAdmin: boolean;
  isFunderUser: boolean;
  org: string;
};

const PILOT_ACCOUNTS: PilotAccount[] = [
  {
    label: "Platform Admin",
    email: "izenzo-admin+pilot@izenzo.test",
    isPlatformAdmin: true,
    isFunderUser: false,
    org: "Izenzo",
  },
  {
    label: "Funder Admin (Pilot Funder Bank)",
    email: "pilot-funder-admin@pilotfunderbank.test",
    isPlatformAdmin: false,
    isFunderUser: true,
    org: "Pilot Funder Bank",
  },
  {
    label: "Reviewer (Pilot Funder Bank)",
    email: "pilot-funder-reviewer@pilotfunderbank.test",
    isPlatformAdmin: false,
    isFunderUser: true,
    org: "Pilot Funder Bank",
  },
  {
    label: "Approver (Pilot Funder Bank)",
    email: "pilot-funder-approver@pilotfunderbank.test",
    isPlatformAdmin: false,
    isFunderUser: true,
    org: "Pilot Funder Bank",
  },
  {
    label: "Viewer (Pilot Funder Bank)",
    email: "pilot-funder-viewer@pilotfunderbank.test",
    isPlatformAdmin: false,
    isFunderUser: true,
    org: "Pilot Funder Bank",
  },
  {
    label: "Isolation Viewer (Isolation Test Fund)",
    email: "isolation-viewer@isolationtestfund.test",
    isPlatformAdmin: false,
    isFunderUser: true,
    org: "Isolation Test Fund",
  },
];

const base = {
  persona: null,
  rawReturnTo: null,
  returnToIsIntentional: false,
  hasPreAuthJourney: false,
} as const;

describe("Pilot persona routing matrix — default landing", () => {
  for (const acc of PILOT_ACCOUNTS) {
    it(`${acc.label} lands on the correct default surface`, () => {
      const dest = resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: acc.isPlatformAdmin,
        isFunderUser: acc.isFunderUser,
      });
      const expected = acc.isFunderUser ? "/funder/workspace" : "/";
      expect(dest).toBe(expected);
    });
  }
});

describe("Pilot persona routing matrix — returnTo behaviour", () => {
  for (const acc of PILOT_ACCOUNTS) {
    it(`${acc.label} honours an intentional /funder/workspace/deals/<id> deep link`, () => {
      const dest = resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: acc.isPlatformAdmin,
        isFunderUser: acc.isFunderUser,
        rawReturnTo: "/funder/workspace/deals/pilot-demo",
        returnToIsIntentional: true,
      });
      expect(dest).toBe("/funder/workspace/deals/pilot-demo?resume=1");
    });

    it(`${acc.label} rejects an external returnTo and falls back safely`, () => {
      const dest = resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: acc.isPlatformAdmin,
        isFunderUser: acc.isFunderUser,
        rawReturnTo: "https://evil.example.com/funder/workspace",
        returnToIsIntentional: true,
      });
      const fallback = acc.isFunderUser ? "/funder/workspace" : "/";
      expect(dest).toBe(fallback);
    });

    it(`${acc.label} rejects protocol-relative //evil.example`, () => {
      const dest = resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: acc.isPlatformAdmin,
        isFunderUser: acc.isFunderUser,
        rawReturnTo: "//evil.example",
        returnToIsIntentional: true,
      });
      expect(dest).toBe(acc.isFunderUser ? "/funder/workspace" : "/");
    });

    it(`${acc.label} drops stale (non-intentional) /desk returnTo`, () => {
      const dest = resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: acc.isPlatformAdmin,
        isFunderUser: acc.isFunderUser,
        rawReturnTo: "/desk",
        returnToIsIntentional: false,
      });
      expect(dest).toBe(acc.isFunderUser ? "/funder/workspace" : "/");
    });
  }

  it("Platform Admin honours an intentional /hq deep link", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: true,
        rawReturnTo: "/hq/users",
        returnToIsIntentional: true,
      }),
    ).toBe("/hq/users?resume=1");
  });

  it("Platform Admin honours an intentional /admin/funder-workspace deep link", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: true,
        rawReturnTo: "/admin/funder-workspace/pilot",
        returnToIsIntentional: true,
      }),
    ).toBe("/admin/funder-workspace/pilot?resume=1");
  });
});

describe("Pilot persona routing matrix — precedence & stale-persona", () => {
  it("Dual-seat (funder + platform_admin) → /funder/workspace by active-persona rule", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        isPlatformAdmin: true,
        isFunderUser: true,
      }),
    ).toBe("/funder/workspace");
  });

  it("Funder user with stale 'trade' persona never leaks to /desk", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        isFunderUser: true,
        persona: "trade",
        hasPreAuthJourney: true,
      }),
    ).toBe("/funder/workspace");
  });

  it("Non-funder trade user with pre-auth journey resumes into /desk", () => {
    expect(
      resolvePostAuthDestination({
        ...base,
        persona: "trade",
        hasPreAuthJourney: true,
      }),
    ).toBe("/desk?resume=1");
  });

  it("Non-funder, no persona → /welcome picker (regression guard)", () => {
    expect(
      resolvePostAuthDestination({ ...base, persona: null }),
    ).toBe("/welcome");
  });
});

describe("Pilot persona routing matrix — adversarial returnTo", () => {
  const cases: Array<[string, string]> = [
    ["javascript:alert(1)", "js scheme"],
    ["/\\evil", "backslash traversal"],
    ["%2F%2Fevil.example", "encoded //"],
    ["/desk\n/x", "newline injection"],
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["/pricing", "public non-allow-listed"],
    ["/", "bare root"],
    ["/auth?returnTo=/", "auth loop"],
  ];
  for (const [raw, label] of cases) {
    it(`funder user rejects ${label} and falls back to /funder/workspace`, () => {
      expect(
        resolvePostAuthDestination({
          ...base,
          isFunderUser: true,
          rawReturnTo: raw,
          returnToIsIntentional: true,
        }),
      ).toBe("/funder/workspace");
    });
    it(`platform admin rejects ${label} and falls back to /`, () => {
      expect(
        resolvePostAuthDestination({
          ...base,
          isPlatformAdmin: true,
          rawReturnTo: raw,
          returnToIsIntentional: true,
        }),
      ).toBe("/");
    });
  }
});
