/**
 * UI-011 / OPS-007 — Mobile viewport safety + public surface cleanliness.
 *
 * Source-pins two invariants we do NOT want to silently regress:
 *
 *   1. Mobile-safe Tailwind primitives stay on the surfaces most likely to
 *      clip or overflow at 360–414px (API key reveal modal + key card
 *      masked block). These are pure presentation classes — no business
 *      logic depends on them, but losing them visually breaks the
 *      one-time secret reveal at phone width.
 *
 *   2. Privileged route URLs declared in src/App.tsx remain wrapped in
 *      RequireAuth (with the correct role gate for /hq and /governance),
 *      and public chrome (AppSidebar / DashboardLayout) is NOT mounted
 *      from a public-only page module.
 *
 * Out of scope:
 *   - No redesign / no token changes / no auth flow changes.
 *   - Visual fidelity beyond "the safety classes are present".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const projectRoot = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.resolve(projectRoot, rel), "utf8");

describe("UI-011 — mobile-safe classes on touched surfaces", () => {
  const apiKeysPanel = read("src/components/developer/ApiKeysPanel.tsx");

  it("API key RevealModal uses a viewport-safe container (max-w-lg + p-4 backdrop)", () => {
    // The modal renders the one-time secret key. At 360–414px the dialog
    // must fit inside the viewport with breathing room — `p-4` on the
    // backdrop guarantees side gutters and `max-w-lg` caps the card width.
    expect(apiKeysPanel).toMatch(/fixed inset-0[^"]*p-4/);
    expect(apiKeysPanel).toMatch(/w-full max-w-lg/);
  });

  it("API key plaintext block uses break-all so long sk_live_… keys cannot overflow", () => {
    // Without `break-all` a 50+ char secret renders as a single token and
    // pushes the modal wider than the viewport on mobile.
    expect(apiKeysPanel).toMatch(/font-mono[^"]*break-all/);
  });

  it("Masked key row in KeyCard scrolls horizontally instead of pushing the card", () => {
    // The hashed masked-key strip must stay inside its parent at 360px.
    expect(apiKeysPanel).toMatch(/overflow-x-auto[^"]*whitespace-nowrap/);
  });

  it("Confirm dialog (revoke/rotate) also uses viewport gutters + capped width", () => {
    expect(apiKeysPanel).toMatch(/w-full max-w-md/);
  });
});

describe("OPS-007 — public surface does not leak admin/HQ chrome", () => {
  const landing = read("src/pages/Landing.tsx");
  const developersPublic = read("src/pages/Developers.tsx");
  const pricing = read("src/pages/Pricing.tsx");
  const docsIndex = read("src/pages/docs/Index.tsx");

  const publicModules = [
    ["Landing", landing],
    ["Developers (public)", developersPublic],
    ["Pricing", pricing],
    ["DocsIndex", docsIndex],
  ] as const;

  it.each(publicModules)("%s does not import AppSidebar", (_, source) => {
    expect(source).not.toMatch(/from\s+["']@\/components\/AppSidebar["']/);
  });

  it.each(publicModules)("%s does not import DashboardLayout", (_, source) => {
    expect(source).not.toMatch(/from\s+["']@\/components\/DashboardLayout["']/);
  });

  it.each(publicModules)("%s does not import the Desk shell", (_, source) => {
    expect(source).not.toMatch(/from\s+["']@\/components\/desk\/DeskLayout["']/);
  });

  it.each(publicModules)("%s does not import HQ-only admin components", (_, source) => {
    // HQ panels live under src/components/admin/. None should ever be
    // pulled into a public landing/marketing module.
    expect(source).not.toMatch(/from\s+["']@\/components\/admin\//);
  });
});

describe("OPS-007 — privileged route URLs in App.tsx are RequireAuth-wrapped", () => {
  const appSource = read("src/App.tsx");

  // Each entry: a substring that must appear in App.tsx, asserting the
  // route is wrapped in RequireAuth (with role gate where applicable).
  const guards: ReadonlyArray<readonly [string, RegExp]> = [
    [
      "/developer/* — RequireAuth around DeveloperCenter",
      /path="\/developer\/\*"\s+element=\{<RequireAuth><DeveloperCenter/,
    ],
    [
      "/welcome — RequireAuth inside Welcome.tsx",
      // Welcome.tsx wraps its own content; we assert App.tsx still routes
      // through the Welcome component (not a bypass alias).
      /path="\/welcome"\s+element=\{<Welcome \/>\}/,
    ],
    [
      "/hq — platform_admin only",
      /path="\/hq"\s+element=\{<RequireAuth role="platform_admin"/,
    ],
    [
      "/hq/:tab — platform_admin only",
      /path="\/hq\/:tab"\s+element=\{<RequireAuth role="platform_admin"/,
    ],
    [
      "/governance/triage — RequireAuth with role gate",
      /path="\/governance\/triage"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/,
    ],
    [
      "/governance/audits — RequireAuth with role gate",
      /path="\/governance\/audits"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/,
    ],
    [
      "/governance/entities — RequireAuth with role gate",
      /path="\/governance\/entities"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/,
    ],
    [
      "/governance/health — RequireAuth with role gate",
      /path="\/governance\/health"\s+element=\{<RequireAuth role=\{\[\.\.\.GOVERNANCE_ROLES\]\}/,
    ],
  ];

  it.each(guards)("%s", (_, pattern) => {
    expect(appSource).toMatch(pattern);
  });

  it("/welcome page itself wraps its content in RequireAuth", () => {
    // Defence-in-depth: even if App.tsx ever changes, Welcome.tsx must
    // refuse to render to an anonymous visitor.
    const welcome = read("src/pages/Welcome.tsx");
    expect(welcome).toMatch(/from\s+["']@\/components\/RequireAuth["']/);
    expect(welcome).toMatch(/<RequireAuth[\s>]/);
  });

  it("legacy /admin/* and /developers/* are redirect-only (no real admin/dev component mount)", () => {
    // /admin/* must be a LegacyRedirect — never a direct <RequireAuth><Admin/></RequireAuth>.
    expect(appSource).toMatch(/path="\/admin\/\*"\s+element=\{<LegacyRedirect/);
    // /developers/keys|webhooks|dlq|docs are all LegacyRedirect → /developer/*
    expect(appSource).toMatch(/path="\/developers\/keys"\s+element=\{<LegacyRedirect/);
    expect(appSource).toMatch(/path="\/developers\/webhooks"\s+element=\{<LegacyRedirect/);
  });
});
