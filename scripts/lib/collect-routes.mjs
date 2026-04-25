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
 * Strict, nesting-aware route extractor for codegen.
 *
 * Walks <Route> tokens linearly tracking a parent-path stack so children of
 * `<Route path="settings">` are emitted as `settings/company`, never as the
 * unqualified `company`. This is what makes `routeTo("/desk/company")` fail
 * to compile while `routeTo("/desk/settings/company")` succeeds.
 *
 * Trade-off vs. the lenient scanner above: this only emits routes whose
 * full nesting can be resolved with literal paths. The lenient matcher in
 * check-routes.mjs is still in play to catch typos in JSX-expression cases.
 */
export function collectRoutePatternsStrict(files, routeConsts) {
  const out = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const prefix = SHELL_PREFIXES[file] ?? "";
    if (prefix) out.add(prefix);
    for (const p of strictWalk(src, routeConsts)) {
      out.add(joinRoute(prefix, p));
    }
  }
  return out;
}

/**
 * Token walker that tracks <Route ...> open/close to resolve true parent
 * paths. Emits any path whose subtree contains no further `<Route>` children
 * (i.e. genuine navigable leaves). `<Route index>` contributes the parent's
 * own path. Routes whose `path` attribute is a non-literal expression are
 * skipped (we cannot statically resolve them).
 */
function strictWalk(src, routeConsts) {
  const ROUTE_TAG_RE = /<Route\b([^>]*?)(\/?)>|<\/Route>/g;
  const PATH_LIT_RE = /\bpath\s*=\s*"([^"]+)"/;
  const PATH_CONST_RE = /\bpath\s*=\s*\{ROUTES\.(\w+)\}/;
  const stack = [];
  const childCount = [];
  const emitted = new Set();

  let m;
  ROUTE_TAG_RE.lastIndex = 0;
  while ((m = ROUTE_TAG_RE.exec(src)) !== null) {
    const isClose = m[0] === "</Route>";
    if (isClose) {
      const popped = stack.pop();
      const kids = childCount.pop();
      if (popped !== undefined && kids === 0) emitted.add(popped);
      continue;
    }
    const attrs = m[1];
    const selfClosing = m[2] === "/";
    const litMatch = attrs.match(PATH_LIT_RE);
    const constMatch = attrs.match(PATH_CONST_RE);
    const raw = litMatch ? litMatch[1] : constMatch ? routeConsts.get(constMatch[1]) : null;
    const isIndex = /\bindex\b/.test(attrs);

    // Treat parents of "*" or "" as empty: a `<Route path="*">` is a
    // pass-through container that hosts nested <Routes>, not a real prefix.
    const parentRaw = stack[stack.length - 1] ?? "";
    const parent = parentRaw === "*" ? "" : parentRaw;
    let composed;
    if (raw == null && isIndex) composed = parent;
    else if (raw == null) composed = null;
    else if (raw.startsWith("/")) composed = raw.replace(/^\/+/, "");
    else composed = parent ? `${parent}/${raw}` : raw;

    if (childCount.length > 0) childCount[childCount.length - 1] += 1;

    if (selfClosing) {
      if (composed != null && composed !== "*" && composed !== "") emitted.add(composed);
    } else {
      stack.push(composed ?? parent);
      childCount.push(0);
    }
  }
  while (stack.length) {
    const popped = stack.pop();
    const kids = childCount.pop();
    if (popped !== undefined && kids === 0) emitted.add(popped);
  }
  return emitted;
}
