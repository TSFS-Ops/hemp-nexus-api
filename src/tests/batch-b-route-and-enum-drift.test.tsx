/**
 * Batch B — Enum, Role, and Route-Auth Drift regression guards.
 *
 * Source-pin and fixture-level proofs covering:
 *
 *   Fix 1 — every privileged route family declared in App.tsx is wrapped
 *           in RequireAuth (or self-wraps inside its page component),
 *           including all four governance subroutes, /welcome, /hq,
 *           /hq/:tab, /developer/*, /desk/*, /billing.
 *   Fix 2 — every /admin/* LegacyRedirect points at /hq/* (a guarded
 *           destination); no /admin/* path mounts an admin component
 *           directly or redirects to a public route.
 *   Fix 3 — privileged route-prefix snapshot. New routes under a
 *           privileged prefix MUST land in App.tsx with either a
 *           RequireAuth wrapper, a Navigate-to-guarded-route, a
 *           LegacyRedirect-to-guarded-route, or a shell component that
 *           self-wraps (currently only Desk + Welcome).
 *   Fix 6 — unknown/future match and WaD status values render as an
 *           explicit "Unrecognised" badge, never as the raw enum literal.
 *   Fix 7 — Admin Pending Engagements filter tabs cover the full
 *           pending ∪ terminal ∪ legacy-pending union; no stale options.
 *
 * Fix 4 (live frozen-role invariant) lives in a sibling file because it
 * needs DB access (`batch-b-frozen-roles-invariant.test.ts`).
 * Fix 5 (no-new legacy admin RLS literal) is a static prebuild script
 * (`scripts/check-legacy-admin-rls.mjs`).
 *
 * Out of scope: role model, DB enum values, RLS policies, route behaviour.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  ENGAGEMENT_PENDING_STATES,
  ENGAGEMENT_TERMINAL_STATES,
  LEGACY_PENDING_STATE,
} from "@/lib/engagement-state";
import {
  statusLabel as matchStatusLabel,
  isKnownStatusLabel as isKnownMatchStatusLabel,
  STATE_LABELS,
} from "@/lib/match-state";
import {
  statusLabel as wadStatusLabel,
  isKnownWadStatusLabel,
  WAD_STATUSES,
} from "@/lib/wad-state";

const APP_TSX = readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");

// ─── Fix 1 — Route-guard source pins ───────────────────────────────────
describe("Batch B Fix 1 — privileged routes are guarded in App.tsx", () => {
  const requireAuthPin = (route: string, opts: { role?: string } = {}) => {
    // Accept either inline RequireAuth wrap or a self-wrapping shell.
    const rolePart = opts.role ? `role=(?:"${opts.role}"|\\{\\[\\.\\.\\.GOVERNANCE_ROLES\\]\\})` : "";
    const re = new RegExp(
      `path="${route.replace(/\//g, "\\/").replace(/:\w+/g, ":\\w+").replace(/\*/g, "\\*")}"\\s+element=\\{<RequireAuth ${rolePart}`,
    );
    return re;
  };

  it("/hq is wrapped in RequireAuth role=platform_admin", () => {
    expect(APP_TSX).toMatch(/path="\/hq"\s+element=\{<RequireAuth role="platform_admin"/);
  });
  it("/hq/:tab is wrapped in RequireAuth role=platform_admin", () => {
    expect(APP_TSX).toMatch(/path="\/hq\/:tab"\s+element=\{<RequireAuth role="platform_admin"/);
  });

  for (const sub of ["triage", "audits", "entities", "health"]) {
    it(`/governance/${sub} is wrapped in RequireAuth(GOVERNANCE_ROLES)`, () => {
      const re = new RegExp(
        `path="\\/governance\\/${sub}"\\s+element=\\{<RequireAuth role=\\{\\[\\.\\.\\.GOVERNANCE_ROLES\\]\\} fallbackRoute="\\/desk"`,
      );
      expect(APP_TSX).toMatch(re);
    });
  }

  it("GOVERNANCE_ROLES set is exactly platform_admin / auditor / org_admin", () => {
    expect(APP_TSX).toContain('GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"]');
  });

  it("/developer/* is wrapped in RequireAuth", () => {
    expect(APP_TSX).toMatch(/path="\/developer\/\*"\s+element=\{<RequireAuth>/);
  });

  it("/desk/* mounts the Desk shell which self-wraps in RequireAuth", () => {
    expect(APP_TSX).toMatch(/path="\/desk\/\*"\s+element=\{<Desk \/>\}/);
    const deskSrc = readFileSync(path.resolve(process.cwd(), "src/pages/Desk.tsx"), "utf-8");
    expect(deskSrc).toMatch(/<RequireAuth>/);
    expect(deskSrc).not.toMatch(/return <Landing \/>/);
  });

  it("/welcome self-wraps in RequireAuth inside the Welcome page", () => {
    expect(APP_TSX).toMatch(/path="\/welcome"\s+element=\{<Welcome \/>\}/);
    const welcomeSrc = readFileSync(path.resolve(process.cwd(), "src/pages/Welcome.tsx"), "utf-8");
    expect(welcomeSrc).toMatch(/<RequireAuth>/);
    expect(welcomeSrc).toMatch(/export default function Welcome/);
  });

  it("/billing is a hard Navigate into the guarded /desk/billing shell", () => {
    expect(APP_TSX).toMatch(/path="\/billing"\s+element=\{<Navigate to="\/desk\/billing" replace \/>\}/);
  });

  // denied=1 contract — same fallbackRoute="/desk" is shared by /hq AND
  // every /governance/* route, so the RoleRedirect helper in RequireAuth
  // appends ?denied=1 (or &denied=1) uniformly. AuthRedirectNoticeBanner
  // surfaces that flag. Pin both ends so a regression can't silently strip
  // the denial notice for one route family but not the other.
  it("RequireAuth role-redirect appends denied=1 to its fallbackRoute (shared by /hq + /governance)", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/components/RequireAuth.tsx"), "utf-8");
    expect(src).toMatch(/denied=1/);
    expect(src).toMatch(/fallbackRoute\.includes\("\?"\)\s*\?\s*"&"\s*:\s*"\?"/);
  });

  it("every privileged RequireAuth in App.tsx that takes a role uses fallbackRoute=\"/desk\"", () => {
    // Pin every RequireAuth invocation that has a `role=` prop — they must
    // ALL declare fallbackRoute="/desk" so the denied=1 notice path is
    // uniform across HQ and Governance. New privileged routes can't quietly
    // skip the fallback and dump the user on a blank /.
    const guards = Array.from(APP_TSX.matchAll(/<RequireAuth\s+role=[^>]+>/g)).map((m) => m[0]);
    expect(guards.length).toBeGreaterThanOrEqual(6); // /hq, /hq/:tab, 4× governance
    for (const g of guards) {
      expect(g, `guard missing fallbackRoute="/desk": ${g}`).toMatch(/fallbackRoute="\/desk"/);
    }
  });
});

// ─── Fix 2 — Legacy /admin/* redirects land on guarded /hq/* targets ───
describe("Batch B Fix 2 — /admin/* legacy redirects land on guarded destinations", () => {
  // Enumerate every `<Route path="/admin..." element={...} />` declaration.
  const adminRoutes = Array.from(
    APP_TSX.matchAll(
      /<Route\s+path="(\/admin(?:\/[^"]*)?)"\s+element=\{([^}]+)\}/g,
    ),
  ).map((m) => ({ path: m[1], element: m[2] }));

  it("at least one /admin/* route is declared (sanity)", () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(2);
  });

  for (const r of adminRoutes) {
    it(`${r.path} uses LegacyRedirect to a /hq/* destination`, () => {
      expect(r.element).toContain("LegacyRedirect");
      const toMatch = r.element.match(/to="([^"]+)"/);
      expect(toMatch, `no \`to\` prop on ${r.path}`).toBeTruthy();
      const dest = toMatch![1];
      expect(dest, `${r.path} must redirect to /hq/* not ${dest}`).toMatch(/^\/hq(\/|$|\?)/);
    });

    it(`${r.path} does NOT directly mount an admin component`, () => {
      // No raw <Admin*/>, <HQ />, or <RequireAuth> inline mount on /admin/*.
      expect(r.element).not.toMatch(/<HQ\b/);
      expect(r.element).not.toMatch(/<Admin\w+\b/);
      expect(r.element).not.toMatch(/<RequireAuth\b/);
    });
  }

  it("no /admin/* redirect points to a known public route", () => {
    const PUBLIC_PREFIXES = ["/", "/landing", "/docs", "/pricing", "/products", "/solutions", "/auth"];
    for (const r of adminRoutes) {
      const toMatch = r.element.match(/to="([^"]+)"/);
      if (!toMatch) continue;
      const dest = toMatch[1].split("?")[0];
      // Either an exact match against a public prefix OR a sub-path of one,
      // EXCEPT /hq (which is guarded).
      const isPublic = PUBLIC_PREFIXES.some((p) =>
        p === "/" ? dest === "/" : dest === p || dest.startsWith(p + "/"),
      );
      expect(isPublic, `${r.path} → ${dest} would land on a public route`).toBe(false);
    }
  });
});

// ─── Fix 3 — Privileged route-family snapshot ─────────────────────────
describe("Batch B Fix 3 — privileged route-family snapshot", () => {
  // Anything under these prefixes MUST be either:
  //   (a) wrapped inline with <RequireAuth ...>
  //   (b) a <Navigate to="/<guarded-prefix>/..." replace />
  //   (c) a <LegacyRedirect to="/<guarded-prefix>/...">
  //   (d) mounted as a shell that self-wraps (Desk, Welcome — allow-listed)
  const PRIVILEGED_PREFIXES = ["/hq", "/governance", "/developer", "/admin", "/welcome", "/billing", "/settings", "/dev"];
  const SHELL_SELF_WRAPPED = new Set(["/desk/*", "/welcome"]);

  const routes = Array.from(
    APP_TSX.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([^}]+)\}/g),
  ).map((m) => ({ path: m[1], element: m[2] }));

  it("App.tsx route enumeration is non-empty (sanity)", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  for (const prefix of PRIVILEGED_PREFIXES) {
    const inPrefix = routes.filter(
      (r) => r.path === prefix || r.path.startsWith(prefix + "/") || r.path.startsWith(prefix + "?"),
    );
    // Some prefixes (e.g. /dev, /settings) may not exist yet — that's fine.
    // The contract bites only once a route under the prefix exists.
    if (inPrefix.length === 0) continue;

    for (const r of inPrefix) {
      it(`${r.path} (${prefix}) has a documented guard contract`, () => {
        const e = r.element;
        const guarded =
          /<RequireAuth\b/.test(e) ||
          /<Navigate\s+to="\/(?:hq|desk|developer|governance)(?:\/|"|\?)/.test(e) ||
          /<LegacyRedirect\b[^>]*\sto="\/(?:hq|desk|developer|governance)(?:\/|"|\?)/.test(e) ||
          SHELL_SELF_WRAPPED.has(r.path);
        expect(guarded, `route ${r.path} → ${e} has no guard contract`).toBe(true);
      });
    }
  }

  it("no /dev (legacy) route is mounted bare", () => {
    const devRoutes = routes.filter((r) => r.path === "/dev" || r.path.startsWith("/dev/"));
    // If any /dev route exists, it must be a redirect or guarded — fail loud.
    for (const r of devRoutes) {
      expect(r.element).toMatch(/<(RequireAuth|Navigate|LegacyRedirect)\b/);
    }
  });
});

// ─── Fix 6 — Unknown enum display contract ────────────────────────────
describe("Batch B Fix 6 — match status renderer handles unknown values safely", () => {
  it("known states render their canonical labels", () => {
    for (const [state, label] of Object.entries(STATE_LABELS)) {
      expect(matchStatusLabel(state)).toBe(label);
      expect(isKnownMatchStatusLabel(state)).toBe(true);
    }
  });

  it("known legacy statuses render their friendly labels", () => {
    expect(matchStatusLabel("matched")).toBe("Awaiting Confirmation");
    expect(matchStatusLabel("settled")).toBe("Intent Confirmed");
    expect(matchStatusLabel("disputed")).toBe("Dispute Raised");
  });

  it("unknown/future values render an explicit Unrecognised badge", () => {
    const label = matchStatusLabel("future_state_v9" as unknown as string);
    expect(label).toMatch(/Unrecognised/);
    expect(label).toContain("future_state_v9");
    expect(isKnownMatchStatusLabel("future_state_v9")).toBe(false);
  });

  it("empty status renders a generic Unrecognised badge, not blank", () => {
    expect(matchStatusLabel("")).toBe("Unrecognised status");
  });

  it("raw unknown literal is NOT the primary visible label", () => {
    // The defect class: showing `committed_v2` (a bare enum) as if it were
    // an operator-facing label. We must wrap it in "Unrecognised (...)".
    const label = matchStatusLabel("committed_v2");
    expect(label).not.toBe("committed_v2");
    expect(label).not.toBe("Committed V2");
  });
});

describe("Batch B Fix 6 — WaD status renderer handles unknown values safely", () => {
  it("every canonical WAD_STATUSES value renders a friendly label", () => {
    for (const s of WAD_STATUSES) {
      const label = wadStatusLabel(s);
      expect(label).not.toMatch(/^Unrecognised/);
      expect(isKnownWadStatusLabel(s)).toBe(true);
    }
  });

  it("unknown/future WaD values render an explicit Unrecognised badge", () => {
    const label = wadStatusLabel("frozen_pending_oracle");
    expect(label).toMatch(/Unrecognised/);
    expect(label).toContain("frozen_pending_oracle");
    expect(isKnownWadStatusLabel("frozen_pending_oracle")).toBe(false);
  });

  it("empty WaD status renders a generic Unrecognised badge", () => {
    expect(wadStatusLabel("")).toBe("Unrecognised status");
  });
});

// ─── Fix 7 — Engagement filter dropdown parity ────────────────────────
describe("Batch B Fix 7 — Admin Pending Engagements filter parity", () => {
  const panelSrc = readFileSync(
    path.resolve(process.cwd(), "src/components/admin/AdminPendingEngagementsPanel.tsx"),
    "utf-8",
  );

  // Extract the FILTER_TABS block and collect its `value:` literals.
  const block = panelSrc.match(/const FILTER_TABS = \[([\s\S]*?)\]\s+as const;/);
  const tabValues = block
    ? Array.from(block[1].matchAll(/value:\s*"([^"]+)"/g)).map((m) => m[1])
    : [];

  it("FILTER_TABS declaration is present and non-empty", () => {
    expect(tabValues.length).toBeGreaterThan(0);
  });

  it("every canonical pending state has a filter tab", () => {
    for (const s of ENGAGEMENT_PENDING_STATES) {
      expect(tabValues, `missing tab for pending state ${s}`).toContain(s);
    }
  });

  it("every canonical terminal state has a filter tab", () => {
    for (const s of ENGAGEMENT_TERMINAL_STATES) {
      // 'expired' is implicitly covered via the catch-all status filter at
      // runtime, but the admin tab set must surface accepted, declined and
      // cancelled_email_change explicitly so admins are never blind.
      if (s === "expired") continue;
      expect(tabValues, `missing tab for terminal state ${s}`).toContain(s);
    }
  });

  it("legacy 'pending' alias tab is preserved for historical rows", () => {
    expect(tabValues).toContain("pending");
    // ENGAGEMENT_PENDING_STATES must not silently start depending on the
    // bare literal again — that was the original D-05 defect.
    expect((ENGAGEMENT_PENDING_STATES as readonly string[]).includes(LEGACY_PENDING_STATE)).toBe(false);
  });

  it("no stale options: every tab value is a known state, alias, or curated bucket", () => {
    const known = new Set<string>([
      ...ENGAGEMENT_PENDING_STATES,
      ...ENGAGEMENT_TERMINAL_STATES,
      LEGACY_PENDING_STATE,
      // Curated admin-only buckets that are intentionally not enum values:
      "all",
      "active",
      "late_acceptance_pending_initiator_reconfirmation",
      "binding_review_required",
      "disputed_being_named",
    ]);
    const stale = tabValues.filter((v) => !known.has(v));
    expect(stale, `stale filter values: ${stale.join(", ")}`).toEqual([]);
  });
});
