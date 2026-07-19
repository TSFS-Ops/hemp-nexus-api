/**
 * Contract tests for the global funder-persona containment resolver.
 * Locks the allow-list, denylist, dual-role precedence, admin regression,
 * loading behaviour and unauthenticated pass-through.
 */
import { describe, it, expect } from "vitest";
import {
  resolveFunderContainment,
  isFunderOnly,
  FUNDER_DENY_PREFIXES,
  type ContainmentSignals,
} from "@/lib/funder-workspace/persona-containment";

const base: ContainmentSignals = {
  loading: false,
  isAuthenticated: true,
  isPlatformAdmin: false,
  isFunderUser: false,
  hasTradeMembership: false,
  selectedPersona: null,
};

const funderOnly: ContainmentSignals = {
  ...base,
  isFunderUser: true,
};

describe("resolveFunderContainment", () => {
  it("allows unauthenticated users everywhere (RequireAuth handles them)", () => {
    for (const p of ["/desk", "/hq", "/admin", "/funder/workspace", "/"]) {
      expect(resolveFunderContainment(p, { ...base, isAuthenticated: false }).kind).toBe("allow");
    }
  });

  it("never contains platform admins", () => {
    const admin = { ...funderOnly, isPlatformAdmin: true };
    for (const p of ["/desk", "/hq/users", "/admin/funder-workspace/pilot", "/registry"]) {
      expect(resolveFunderContainment(p, admin).kind).toBe("allow");
    }
  });

  it("allows trade-only users through", () => {
    const trade = { ...base, hasTradeMembership: true };
    for (const p of ["/desk", "/desk/wizard", "/hq", "/registry", "/docs"]) {
      expect(resolveFunderContainment(p, trade).kind).toBe("allow");
    }
  });

  it("returns loading while probing for a funder-membership user", () => {
    expect(
      resolveFunderContainment("/desk", { ...funderOnly, loading: true }).kind,
    ).toBe("loading");
  });

  it("does NOT flash a redirect while loading", () => {
    // loading must never resolve to a redirect kind.
    const d = resolveFunderContainment("/hq", { ...funderOnly, loading: true });
    expect(d.kind).not.toBe("redirect");
  });

  describe("funder-only user (no trade membership)", () => {
    it("redirects every denied prefix to /funder/workspace", () => {
      const denied = [
        "/desk",
        "/desk/wizard",
        "/desk/match/abc",
        "/dashboard",
        "/dashboard/matches",
        "/admin",
        "/admin/funder-workspace/pilot",
        "/hq",
        "/hq/users",
        "/registry",
        "/registry/search",
        "/governance",
        "/governance/triage",
        "/compliance",
        "/marketplace",
        "/discovery",
        "/matches",
        "/support",
        "/support/new",
        "/docs",
        "/docs/api",
        "/welcome",
        "/developer/keys",
        "/developers/keys",
        "/trade/wizard",
        "/billing",
      ];
      for (const p of denied) {
        const d = resolveFunderContainment(p, funderOnly);
        expect(d.kind, `expected redirect for ${p}`).toBe("redirect");
        if (d.kind === "redirect") expect(d.to).toBe("/funder/workspace");
      }
    });

    it("allows the funder workspace and its children", () => {
      for (const p of [
        "/funder/workspace",
        "/funder/workspace/deals",
        "/funder/workspace/deals/abc",
        "/funder/workspace/profile",
        "/funder/compliance-summary",
        "/funder/p5-batch3",
        "/funder/evidence-pack",
      ]) {
        expect(resolveFunderContainment(p, funderOnly).kind).toBe("allow");
      }
    });

    it("allows auth, unsubscribe, status, trust, root, marketing", () => {
      for (const p of ["/", "/auth", "/reset-password", "/unsubscribe", "/status", "/trust", "/products/trade-desk", "/solutions/traders", "/pricing"]) {
        expect(resolveFunderContainment(p, funderOnly).kind).toBe("allow");
      }
    });
  });

  describe("dual-role user (funder + trade)", () => {
    const dual: ContainmentSignals = {
      ...base,
      isFunderUser: true,
      hasTradeMembership: true,
    };

    it("defaults to allowing trade routes (no explicit funder persona)", () => {
      expect(resolveFunderContainment("/desk", dual).kind).toBe("allow");
      expect(resolveFunderContainment("/hq", dual).kind).toBe("allow");
    });

    it("contains dual-role user with explicit funder persona", () => {
      const funderPersona = { ...dual, selectedPersona: "funder" };
      const d = resolveFunderContainment("/desk", funderPersona);
      expect(d.kind).toBe("redirect");
      if (d.kind === "redirect") expect(d.to).toBe("/funder/workspace");
    });

    it("respects explicit trade persona on dual-role user", () => {
      const tradePersona = { ...dual, selectedPersona: "trade" };
      expect(resolveFunderContainment("/desk", tradePersona).kind).toBe("allow");
    });
  });

  it("uses replace-worthy destination (no loop): /funder/workspace itself is allowed", () => {
    expect(resolveFunderContainment("/funder/workspace", funderOnly).kind).toBe("allow");
  });

  it("does not redirect for marketing/legal paths that aren't in the denylist", () => {
    expect(resolveFunderContainment("/some/unknown/marketing", funderOnly).kind).toBe("allow");
  });
});

describe("isFunderOnly", () => {
  it("false when no funder membership", () => {
    expect(isFunderOnly(base)).toBe(false);
  });
  it("true when funder membership and no trade membership", () => {
    expect(isFunderOnly(funderOnly)).toBe(true);
  });
  it("false for dual-role user with no selected persona", () => {
    expect(isFunderOnly({ ...funderOnly, hasTradeMembership: true })).toBe(false);
  });
  it("true for dual-role user with selected funder persona", () => {
    expect(
      isFunderOnly({ ...funderOnly, hasTradeMembership: true, selectedPersona: "funder" }),
    ).toBe(true);
  });
});

describe("deny-prefix invariants", () => {
  it("covers every high-risk platform shell", () => {
    for (const required of ["/desk", "/hq", "/admin", "/registry", "/governance", "/compliance", "/support", "/docs"]) {
      expect(FUNDER_DENY_PREFIXES).toContain(required);
    }
  });
});
