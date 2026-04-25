/**
 * Shared route-pattern collector.
 *
 * Used by:
 *   - scripts/check-routes.mjs         (verifies <Link to="…"> + edge-fn URLs)
 *   - scripts/generate-routes.mjs      (emits src/lib/routes.generated.ts)
 *
 * The two consumers MUST agree on the set of registered route patterns,
 * otherwise the typed `routeTo()` helper could permit a path the runtime
 * router doesn't recognise (or vice-versa). Sharing one extractor is the
 * only way to guarantee that invariant.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Mount points: routes inside these files are nested under the prefix shown.
// Keep in lock-step with src/App.tsx.
export const SHELL_PREFIXES = {
  "src/pages/Desk.tsx": "/desk",
  "src/pages/DeveloperCenter.tsx": "/developer",
  "src/pages/HQ.tsx": "/hq",
};

export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "test") continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export function loadRouteConstants() {
  const map = new Map();
  try {
    const src = readFileSync("src/lib/constants.ts", "utf8");
    const blockMatch = src.match(/ROUTES\s*=\s*\{([\s\S]*?)\}\s*as const/);
    if (!blockMatch) return map;
    const body = blockMatch[1];
    const entryRe = /(\w+)\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) map.set(m[1], m[2]);
  } catch {
    /* optional */
  }
  return map;
}

function joinRoute(prefix, child) {
  if (!prefix) return child;
  if (child.startsWith("/")) return child;
  if (child === "" || child === "*") return `${prefix}/*`;
  return `${prefix}/${child}`;
}

function extractRoutesFromSource(src, prefix, routeConsts) {
  const patterns = new Set();
  const LIT_RE = /<Route\b[^>]*?\bpath\s*=\s*"([^"]+)"/g;
  const CONST_RE = /<Route\b[^>]*?\bpath\s*=\s*\{ROUTES\.(\w+)\}/g;
  for (const re of [LIT_RE, CONST_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const raw = re === LIT_RE ? m[1] : routeConsts.get(m[1]);
      if (!raw) continue;
      patterns.add(joinRoute(prefix, raw));
    }
  }
  // Tabbed sub-views: register `<Route path="settings">` as `settings/*` so
  // `/desk/settings/company` etc. match without us having to fully parse
  // nested JSX. See check-routes.mjs for the rationale.
  const TABBED_PARENT_RE = /<Route\b[^>]*?\bpath\s*=\s*"(settings)"[^>]*>/g;
  let tm;
  while ((tm = TABBED_PARENT_RE.exec(src)) !== null) {
    patterns.add(joinRoute(prefix, `${tm[1]}/*`));
  }
  return patterns;
}

export function collectRoutePatterns(files, routeConsts) {
  const patterns = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const prefix = SHELL_PREFIXES[file] ?? "";
    for (const p of extractRoutesFromSource(src, prefix, routeConsts)) patterns.add(p);
    if (prefix) patterns.add(prefix);
  }
  return patterns;
}

/**
 * Nested-parent registry: maps `<shellPrefix><parent>` → list of child
 * segments declared inside that parent's <Route> block. Encoded explicitly
 * because JSX inside `element={…}` props defeats regex-based depth tracking,
 * and the project has only one nested parent in the entire codebase
 * (Desk → settings).
 *
 * If a future PR adds another nested parent, add it here AND ensure the
 * lenient flat scan keeps treating the parent as `parent/*` (it does, via
 * the `TABBED_PARENT_RE` rule above).
 */
export const NESTED_PARENTS = {
  "/desk/settings": ["company", "notifications", "balance"],
};

/**
 * Strict route extractor for codegen. Returns the same set as the lenient
 * scanner BUT:
 *   • drops orphan tab paths whose real home is a nested parent (so
 *     `/desk/company` is removed in favour of `/desk/settings/company`)
 *   • adds the composed nested children explicitly
 *
 * Result: a `RoutePath` union that contains only paths the runtime router
 * actually serves, so `routeTo("/desk/company")` fails to compile.
 */
export function collectRoutePatternsStrict(files, routeConsts) {
  const lenient = collectRoutePatterns(files, routeConsts);

  // Build the orphan set: every child that is registered under a nested
  // parent must NOT also appear at the shell-root level.
  const orphans = new Set();
  for (const [parentPath, children] of Object.entries(NESTED_PARENTS)) {
    const lastSlash = parentPath.lastIndexOf("/");
    const shellPrefix = parentPath.slice(0, lastSlash); // e.g. "/desk"
    for (const child of children) {
      orphans.add(`${shellPrefix}/${child}`);
    }
  }

  const out = new Set();
  for (const p of lenient) {
    if (orphans.has(p)) continue; // drop the false-flat duplicate
    if (p === "*") continue;
    if (p.endsWith("/*")) continue; // catch-alls aren't navigable destinations
    out.add(p);
  }
  // Add the true nested paths.
  for (const [parentPath, children] of Object.entries(NESTED_PARENTS)) {
    out.add(parentPath); // the parent itself renders an index
    for (const child of children) out.add(`${parentPath}/${child}`);
  }
  return out;
}
