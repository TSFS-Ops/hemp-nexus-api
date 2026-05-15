/**
 * UI-004 / UI-007 — Credit badge cache invalidation and cross-tab refresh.
 *
 * Source-pin tests. They verify the agreed contract:
 *
 *   1. A shared helper `invalidateAllCreditBalanceQueries` exists in
 *      `src/lib/credit-balance-invalidation.ts` and covers every known
 *      credit/balance query prefix.
 *   2. All scattered invalidation sites (use-match-details, AcceptBindCard,
 *      Billing, AdminTokenManagement) import and use the shared helper.
 *   3. The POI mint success branch in use-match-details calls
 *      `refetchQueries` for `["token-balance"]` with `exact: false` so the
 *      badge updates promptly.
 *   4. `src/lib/cross-tab-bus.ts` exports `publish` and
 *      `useCrossTabInvalidate`, uses BroadcastChannel name `izenzo-cache`,
 *      and has a localStorage/storage fallback.
 *   5. use-match-details publishes `credit-balance` after mint and
 *      `engagement-status` after the soft-route 202.
 *   6. Billing publishes `credit-balance` after purchase verification.
 *   7. App.tsx mounts the cross-tab consumer once.
 *   8. MatchDetails registers a `visibilitychange` listener and, on the
 *      visible-after-hidden path, calls `fetchMatch()` and invalidates
 *      `engagement-status-gate`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("UI-004 — Shared credit-balance invalidation helper", () => {
  const helper = read("src/lib/credit-balance-invalidation.ts");

  it("exports invalidateAllCreditBalanceQueries", () => {
    expect(helper).toMatch(/export function invalidateAllCreditBalanceQueries/);
  });

  it("covers every known credit/balance query prefix", () => {
    for (const key of [
      "token-balance",
      "token-balance-confirm",
      "token-balance-confirm-single",
      "token-balance-progression",
      "token-balance-compiler",
      "admin-token-balances",
    ]) {
      expect(helper).toContain(`"${key}"`);
    }
  });

  it("iterates the prefix list to invalidate each one", () => {
    expect(helper).toMatch(/queryClient\.invalidateQueries\(\{\s*queryKey:/);
  });
});

describe("UI-004 — All balance invalidation sites use the shared helper", () => {
  const sites: Record<string, string> = {
    "src/hooks/use-match-details.ts": read("src/hooks/use-match-details.ts"),
    "src/components/match/AcceptBindCard.tsx": read("src/components/match/AcceptBindCard.tsx"),
    "src/pages/Billing.tsx": read("src/pages/Billing.tsx"),
    "src/components/admin/AdminTokenManagement.tsx": read("src/components/admin/AdminTokenManagement.tsx"),
  };

  for (const [path, src] of Object.entries(sites)) {
    it(`${path} imports invalidateAllCreditBalanceQueries`, () => {
      expect(src).toMatch(/from\s+"@\/lib\/credit-balance-invalidation"/);
      expect(src).toContain("invalidateAllCreditBalanceQueries");
    });

    it(`${path} actually calls invalidateAllCreditBalanceQueries`, () => {
      expect(src).toMatch(/invalidateAllCreditBalanceQueries\(\s*queryClient\s*\)/);
    });
  }
});

describe("UI-004 — POI mint refetches token-balance immediately", () => {
  const src = read("src/hooks/use-match-details.ts");

  it("calls refetchQueries(['token-balance'], { exact: false }) after mint", () => {
    // Two mint success paths (legacy settle + handleStateAction); both must
    // refetch so the badge is fresh before the success toast clears.
    const matches = src.match(/refetchQueries\(\s*\{\s*queryKey:\s*\["token-balance"\][\s\S]*?exact:\s*false[\s\S]*?\}\s*\)/g);
    expect(matches && matches.length >= 2).toBe(true);
  });
});

describe("UI-007 — Cross-tab cache bridge module", () => {
  const bus = read("src/lib/cross-tab-bus.ts");

  it("exports publish and useCrossTabInvalidate", () => {
    expect(bus).toMatch(/export function publish\b/);
    expect(bus).toMatch(/export function useCrossTabInvalidate\b/);
  });

  it("uses BroadcastChannel name 'izenzo-cache'", () => {
    expect(bus).toMatch(/CROSS_TAB_CHANNEL_NAME\s*=\s*"izenzo-cache"/);
    expect(bus).toMatch(/new BroadcastChannel\(\s*CROSS_TAB_CHANNEL_NAME\s*\)/);
  });

  it("has a localStorage/storage-event fallback", () => {
    expect(bus).toMatch(/localStorage\.setItem/);
    expect(bus).toMatch(/addEventListener\("storage"/);
  });

  it("knows the three event kinds", () => {
    for (const kind of ["credit-balance", "match", "engagement-status"]) {
      expect(bus).toContain(`"${kind}"`);
    }
  });
});

describe("UI-007 — Mutation publishers", () => {
  const matchHook = read("src/hooks/use-match-details.ts");
  const billing = read("src/pages/Billing.tsx");

  it("use-match-details publishes credit-balance after mint", () => {
    expect(matchHook).toMatch(/publishCrossTab\(\s*\{\s*kind:\s*"credit-balance"\s*\}\s*\)/);
  });

  it("use-match-details publishes engagement-status after soft-route", () => {
    const occurrences = matchHook.match(/publishCrossTab\(\s*\{\s*kind:\s*"engagement-status"/g);
    expect(occurrences && occurrences.length >= 2).toBe(true);
  });

  it("Billing publishes credit-balance after purchase verification", () => {
    expect(billing).toMatch(/from\s+"@\/lib\/cross-tab-bus"/);
    const occurrences = billing.match(/publishCrossTab\(\s*\{\s*kind:\s*"credit-balance"\s*\}\s*\)/g);
    expect(occurrences && occurrences.length >= 2).toBe(true);
  });
});

describe("UI-007 — App.tsx mounts the cross-tab consumer once", () => {
  const app = read("src/App.tsx");

  it("imports CrossTabCacheBridge", () => {
    expect(app).toMatch(/import\s+\{\s*CrossTabCacheBridge\s*\}\s+from\s+"@\/lib\/cross-tab-bus"/);
  });

  it("renders <CrossTabCacheBridge /> exactly once", () => {
    const matches = app.match(/<CrossTabCacheBridge\b/g);
    expect(matches && matches.length).toBe(1);
  });
});

describe("UI-007 — MatchDetails focus refetch", () => {
  const page = read("src/pages/MatchDetails.tsx");

  it("registers a visibilitychange listener", () => {
    expect(page).toMatch(/addEventListener\(\s*"visibilitychange"/);
    expect(page).toMatch(/removeEventListener\(\s*"visibilitychange"/);
  });

  it("uses a >5s hidden threshold before refetching", () => {
    expect(page).toMatch(/Date\.now\(\)\s*-\s*since\s*>\s*5000/);
  });

  it("calls fetchMatch() on the visible-after-hidden path", () => {
    expect(page).toMatch(/void\s+fetchMatch\(\)/);
  });

  it("invalidates engagement-status-gate for the current matchId", () => {
    expect(page).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\["engagement-status-gate",\s*matchId\]\s*\}\s*\)/);
  });
});
