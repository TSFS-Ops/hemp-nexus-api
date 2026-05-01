/**
 * Desk route integrity — regression guard.
 *
 * Originally broken: `StateProgressionCard` linked to `/desk/settings/identity`
 * (a route that never existed). The user clicked "Go to Company Identity",
 * landed on a 404, and could not start their KYB review.
 *
 * This test extracts:
 *   1. The truth set of registered Desk routes from `src/pages/Desk.tsx`.
 *   2. Every `<Link to="/desk/...">` and `navigate("/desk/...")` string in `src/`.
 *
 * Then asserts every linked Desk path resolves to a registered route.
 *
 * The check is intentionally conservative — query strings (`?step=entity`)
 * and trailing-slash variants are normalised before comparison. Dynamic path
 * params (e.g. `/desk/match/${matchId}`) are matched against the route's
 * `:matchId` placeholder.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = resolve(PROJECT_ROOT, "src");
const DESK_FILE = resolve(SRC_DIR, "pages", "Desk.tsx");

// ── 1. Extract registered routes from Desk.tsx ────────────────────────────

/**
 * Returns the set of Desk paths that React Router will resolve, e.g.
 *   ["/desk", "/desk/discover", "/desk/settings", "/desk/settings/company",
 *    "/desk/settings/notifications", "/desk/settings/balance",
 *    "/desk/match/:matchId", ...]
 *
 * Implementation: parse `<Route path="..."` strings out of Desk.tsx and
 * combine them with their parent context. The parent of every nested
 * <Routes> in this file is `/desk`, except the explicit `settings` block
 * which nests under `/desk/settings`.
 */
function extractRegisteredDeskRoutes(): Set<string> {
  const src = readFileSync(DESK_FILE, "utf8");

  // Pull every path="..." literal that appears in a <Route ...> tag.
  const routePathRegex = /<Route\s+[^>]*\bpath=["']([^"']+)["']/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = routePathRegex.exec(src)) !== null) {
    paths.push(m[1]);
  }

  // Detect the settings nested block so we can prefix its children.
  // We look for a Route with path="settings" that opens a nested <Route> list.
  const settingsBlockRegex =
    /<Route\s+path=["']settings["'][^>]*>([\s\S]*?)<\/Route>/m;
  const settingsBlock = src.match(settingsBlockRegex)?.[1] ?? "";
  const settingsChildPaths: string[] = [];
  let cm: RegExpExecArray | null;
  const childRegex = /<Route\s+[^>]*\bpath=["']([^"']+)["']/g;
  while ((cm = childRegex.exec(settingsBlock)) !== null) {
    settingsChildPaths.push(cm[1]);
  }

  const registered = new Set<string>();
  // Always-on: bare /desk and the settings index (handled by `index` element).
  registered.add("/desk");
  registered.add("/desk/settings");

  for (const p of paths) {
    if (p === "*" || p === "") continue;
    // The settings children appear in `paths` too but should be prefixed.
    if (settingsChildPaths.includes(p)) {
      registered.add(`/desk/settings/${p}`);
    } else {
      registered.add(`/desk/${p}`);
    }
  }

  return registered;
}

// ── 2. Walk src/ and collect every Desk-target navigation string ──────────

interface LinkRef {
  file: string;
  rawPath: string; // exactly as written in source
  path: string; // normalised (no querystring, no trailing slash, params templated)
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "tests", // do not lint the tests themselves
  "test",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Replace dynamic params (`${...}`, template holes, plain string concat
 * markers) with the React-Router `:param` placeholder shape. We don't try to
 * be clever about WHICH param — the registered route will also have `:foo`,
 * so we collapse both sides to a single sentinel.
 */
function normalisePath(raw: string): string {
  // Strip query string and hash.
  let p = raw.split("?")[0].split("#")[0];
  // Trim trailing slash unless it's the root.
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // Collapse `${...}` template expressions and `:param` placeholders.
  p = p.replace(/\$\{[^}]+\}/g, ":PARAM");
  p = p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":PARAM");
  return p;
}

function collectDeskLinks(): LinkRef[] {
  const files = walk(SRC_DIR);
  const refs: LinkRef[] = [];

  // Capture three forms used by react-router-dom for actual user-driven nav:
  //   <Link to="/desk/...">          (JSX attribute, single or double quotes)
  //   <Link to={`/desk/...`}>        (template literal)
  //   navigate("/desk/...")          (imperative)
  //
  // Excluded by design (different semantics, not user-clickable links):
  //   • <Navigate to="..."/>             — declarative redirect inside the
  //     router tree itself; lives in pages/Desk.tsx and is defining behaviour,
  //     not consuming it.
  //   • <LegacyRedirect to="..."/>       — custom wrapper whose `to` prop is a
  //     fallback label; the real destination is computed via `resolveTo`.
  //   • The Desk router file itself (src/pages/Desk.tsx) — it DEFINES routes
  //     and is allowed to reference its own forward targets.
  const patterns: Array<{ re: RegExp; group: number }> = [
    // <Link to="...">  — anchored on `<Link ` to exclude <Navigate /<LegacyRedirect.
    { re: /<Link\s+[^>]*\bto=["'](\/desk[^"']*)["']/g, group: 1 },
    { re: /<Link\s+[^>]*\bto=\{`(\/desk[^`]*)`\}/g, group: 1 },
    // navigate("/desk/...") — react-router useNavigate.
    { re: /\bnavigate\(\s*["'`](\/desk[^"'`]*)["'`]/g, group: 1 },
  ];

  for (const file of files) {
    // Skip the Desk router file itself — it defines redirect targets that
    // intentionally reference its own routes via <Navigate>.
    if (file === DESK_FILE) continue;

    const src = readFileSync(file, "utf8");
    for (const { re, group } of patterns) {
      let m: RegExpExecArray | null;
      // Reset lastIndex per file (regex state).
      re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) {
        const rawPath = m[group];
        refs.push({ file, rawPath, path: normalisePath(rawPath) });
      }
    }
  }
  return refs;
}

/**
 * A linked path matches a registered route if either:
 *   a) exact match after normalisation, OR
 *   b) exact match after collapsing both to their `:PARAM` shape, OR
 *   c) the linked path is a parent of a registered route (e.g. `/desk` itself
 *      or `/desk/settings` — both serve content via the parent layout/index).
 */
function pathMatchesAnyRegistered(
  linkedPath: string,
  registered: Set<string>,
): boolean {
  const linkNorm = normalisePath(linkedPath);
  for (const reg of registered) {
    const regNorm = normalisePath(reg);
    if (linkNorm === regNorm) return true;
  }
  // Allow exact-prefix matches for layout routes (e.g. `/desk` matches
  // because Desk.tsx mounts the overview at the layout root).
  return registered.has(linkNorm);
}

// ── 3. Tests ───────────────────────────────────────────────────────────────

describe("Desk route integrity", () => {
  const registered = extractRegisteredDeskRoutes();

  it("extracts a non-empty set of registered Desk routes", () => {
    expect(registered.size).toBeGreaterThan(3);
    // Sanity anchors that this suite assumes exist:
    expect(registered.has("/desk")).toBe(true);
    expect(registered.has("/desk/settings")).toBe(true);
    expect(registered.has("/desk/settings/company")).toBe(true);
    expect(registered.has("/desk/discover")).toBe(true);
  });

  it("does NOT register the historically-broken path /desk/settings/identity", () => {
    // If someone re-introduces this route accidentally, they should also
    // fix the link rather than silently making the bug invisible.
    expect(registered.has("/desk/settings/identity")).toBe(false);
  });

  it("every <Link> and navigate() Desk target resolves to a registered route", () => {
    const refs = collectDeskLinks();
    expect(refs.length).toBeGreaterThan(0);

    const broken = refs.filter(
      (r) => !pathMatchesAnyRegistered(r.path, registered),
    );

    if (broken.length > 0) {
      const formatted = broken
        .map(
          (b) =>
            `  • ${b.rawPath}  (normalised: ${b.path})\n    in ${b.file.replace(PROJECT_ROOT + "/", "")}`,
        )
        .join("\n");
      const registeredList = [...registered].sort().join("\n  ");
      throw new Error(
        `Found ${broken.length} Desk link(s) targeting routes that are NOT registered in src/pages/Desk.tsx:\n\n${formatted}\n\nRegistered Desk routes are:\n  ${registeredList}\n\nFix the link, or add the route to Desk.tsx if it is intentionally new.`,
      );
    }

    expect(broken).toEqual([]);
  });

  it("the KYB verification redirect specifically resolves to /desk/settings/company", () => {
    // Pin the contract that the bug fix established: the alert in
    // StateProgressionCard MUST link into the Company Identity tab.
    const card = readFileSync(
      resolve(SRC_DIR, "components", "match", "StateProgressionCard.tsx"),
      "utf8",
    );
    // Find the link inside the legitimacy-blocked alert. We anchor on the
    // user-visible heading copy so a future copy change forces a re-check.
    const alertIdx = card.indexOf(
      // Copy was intentionally softened from "Verification required" to
      // "Company Identity (KYB) verification recommended" — KYB is now
      // recommended pre-POI and only hard-enforced at WaD. We anchor on
      // the stable substring that still asserts the alert renders for
      // the legitimacy-blocked POI flow.
      "verification recommended before issuing a Proof of Intent",
    );
    expect(alertIdx).toBeGreaterThan(-1);

    // Search forward from the heading for the next `to="..."` literal.
    const tail = card.slice(alertIdx, alertIdx + 1500);
    const linkMatch = tail.match(/\bto=["']([^"']+)["']/);
    expect(linkMatch, "no <Link to=...> found near the legitimacy alert").not.toBeNull();

    const target = linkMatch![1];
    const normalised = normalisePath(target);
    expect(normalised).toBe("/desk/settings/company");
    // And that registered route must exist.
    expect(registered.has(normalised)).toBe(true);
  });
});
