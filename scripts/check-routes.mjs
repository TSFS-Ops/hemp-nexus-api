#!/usr/bin/env node
/**
 * Route Guard — fails the build if any <Link to="...">, <Navigate to="...">,
 * or navigate("...") target points to a path not registered in the app's
 * router.
 *
 * Why: the KYB redirect bug (and a follow-up "Initiate Trade Request" bug)
 * silently shipped a CTA pointing at a route that did not exist, dumping the
 * user on the NotFound page. Route mistakes are a recurring defect class
 * because React Router resolves them at runtime — TypeScript can't help.
 *
 * What it checks:
 *   1. Walk src/**\/*.{ts,tsx} and collect every literal <Route path="..."> string.
 *      Nested shells (Desk, DeveloperCenter, HQ) are mounted via /desk/*,
 *      /developer/*, /hq, /hq/:tab in App.tsx; this script knows those mount
 *      prefixes and combines them with the nested children so /desk/discover,
 *      /desk/settings/company, /developer/keys, etc. are recognised.
 *   2. Walk the same files and collect every literal navigation target from:
 *        - <Link to="/..."> / <NavLink to="/...">
 *        - <Navigate to="/..." />
 *        - navigate("/...") calls
 *   3. For each literal target, normalise (strip query/hash) and check it
 *      matches at least one registered route pattern (treating :param and *
 *      as wildcards). Targets built from template literals or variables are
 *      skipped — only static, leading-slash strings are checked, because
 *      those are the ones a build-time guard can verify with confidence.
 *
 * Run:  npm run check:routes   (also wired into "build")
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = "src";

// ── Nested shell mount points declared in src/App.tsx ──────────────────────
// Routes defined inside these shells are resolved at runtime as
// `${prefix}/${childPath}`. We pre-compute the full pattern so the matcher
// can treat /desk/settings/company the same as a top-level route.
const SHELL_PREFIXES = {
  "src/pages/Desk.tsx": "/desk",
  "src/pages/DeveloperCenter.tsx": "/developer",
  "src/pages/HQ.tsx": "/hq",
};

// ── File walking ───────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip generated/test artefacts
      if (entry === "node_modules" || entry === "__tests__" || entry === "test") continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ── Route extraction ───────────────────────────────────────────────────────
// Matches <Route path="literal" ...>. Ignores expressions like path={ROUTES.X}.
const ROUTE_PATH_RE = /<Route\b[^>]*?\bpath\s*=\s*"([^"]+)"/g;

// Map literal route constants from src/lib/constants.ts so that
// path={ROUTES.AUTH} style declarations are also recognised. We just grep the
// constants file for `KEY: "/literal"` pairs.
function loadRouteConstants() {
  const map = new Map();
  try {
    const src = readFileSync("src/lib/constants.ts", "utf8");
    const blockMatch = src.match(/ROUTES\s*=\s*\{([\s\S]*?)\}\s*as const/);
    if (!blockMatch) return map;
    const body = blockMatch[1];
    // Accept single OR double-quoted string literals.
    const entryRe = /(\w+)\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      map.set(m[1], m[2]);
    }
  } catch {
    /* constants file optional */
  }
  return map;
}

/**
 * Nesting-aware <Route> extractor. Walks the source linearly tracking a
 * stack of parent paths so that
 *   <Route path="settings"><Route path="company" /></Route>
 * yields both "settings" and "settings/company" — which then get prefixed
 * with the shell mount (e.g. "/desk") to produce the full registered path.
 *
 * We accept both `path="literal"` and `path={ROUTES.KEY}` forms. Routes
 * without a path (e.g. `<Route index ...>`) are still pushed as a frame so
 * the nesting depth stays correct, but they contribute the parent path
 * itself as a registered route (an index route renders at the parent URL).
 */
function extractRoutesFromSource(src, prefix, routeConsts) {
  const patterns = new Set();
  // 1. Flat extraction: every literal `<Route path="...">` (and the
  //    constant form `<Route path={ROUTES.X}>`) anywhere in the file
  //    becomes a registered pattern. We do not try to fully compose
  //    arbitrarily nested parent/child paths because Routes nested inside
  //    `element={<Outer><Routes>…` expressions make full composition
  //    fragile. A flat scan covers every legitimate URL at the cost of
  //    also accepting some non-existent permutations (e.g. `/desk/company`
  //    even though the real path is `/desk/settings/company`). The guard's
  //    purpose is catching link *typos* like `/desk/initiate`, not policing
  //    route definitions.
  const LIT_RE = /<Route\b[^>]*?\bpath\s*=\s*"([^"]+)"/g;
  const CONST_RE = /<Route\b[^>]*?\bpath\s*=\s*\{ROUTES\.(\w+)\}/g;
  const flat = [];
  for (const re of [LIT_RE, CONST_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const raw = re === LIT_RE ? m[1] : routeConsts.get(m[1]);
      if (!raw) continue;
      patterns.add(joinRoute(prefix, raw));
      flat.push(raw);
    }
  }

  // 2. One-level composition for direct parent→child JSX nesting (i.e.
  //    children that are siblings of `element={...}`, NOT children buried
  //    inside it). We need a brace + string aware scanner here because a
  //    naive regex stops at the first `>` inside `element={<Foo>...}` and
  //    misidentifies self-closing parent Routes as containers, which then
  //    swallow every following sibling Route as a phantom child. Catches
  //    the common `<Route path="settings"><Route path="company" /></Route>`
  //    pattern used by tabbed sub-views like /desk/settings/company.
  const containers = findContainerRoutes(src);
  for (const c of containers) {
    if (c.path == null) continue;
    if (c.path.startsWith("/")) continue; // absolute parents handled flat
    const childRe = /<Route\b[^>]*?\bpath\s*=\s*"([^"]+)"/g;
    let cm;
    while ((cm = childRe.exec(c.body)) !== null) {
      const child = cm[1];
      if (child.startsWith("/")) continue;
      const composed = `${c.path.replace(/\/+$/, "")}/${child}`;
      patterns.add(joinRoute(prefix, composed));
    }
  }
  return patterns;
}

/**
 * Scan for `<Route>` container blocks (those with an explicit `</Route>`
 * close, not self-closing) and return each container's path + inner body.
 * Used to compose one level of parent/child route paths so that nested
 * tabbed sub-views like `<Route path="settings"><Route path="company"/>`
 * register as `/desk/settings/company`.
 *
 * We deliberately do NOT track curly-brace nesting when locating the end
 * of an opening tag. Embedded `>` characters (e.g. inside `element={<Foo>`)
 * would otherwise hide `<Route path="settings">` blocks that live inside
 * an `element={…}` expression of a self-closing parent — which is exactly
 * the structure used by /desk/* in this codebase. Treating every `>` as
 * end-of-tag means some non-Route JSX is briefly misread, but only `<Route`
 * tokens are pushed to the stack so the consequence is harmless.
 */
function findContainerRoutes(src) {
  const out = [];
  const stack = []; // { path, bodyStart }
  // Match either an opening <Route ...> (with the rest of its tag up to
  // the next `>`) or a closing </Route>. We do NOT require self-closing
  // tags to balance — they are detected by the trailing `/` in the body.
  const TAG_RE = /<(\/)?Route\b([^>]*)>/g;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const isClose = m[1] === "/";
    if (isClose) {
      const frame = stack.pop();
      if (frame) {
        out.push({ path: frame.path, body: src.slice(frame.bodyStart, m.index) });
      }
      continue;
    }
    let attrs = m[2];
    const selfClosing = attrs.trimEnd().endsWith("/");
    if (selfClosing) continue; // self-closing: contributes nothing to the parent stack
    if (attrs.trimEnd().slice(-1) === "/") attrs = attrs.trimEnd().slice(0, -1);
    const litMatch = attrs.match(/\bpath\s*=\s*"([^"]+)"/);
    const path = litMatch ? litMatch[1] : null;
    stack.push({ path, bodyStart: m.index + m[0].length });
  }
  return out;
}

/** Apply the shell mount prefix to a child route path. */
function joinRoute(prefix, child) {
  if (!prefix) return child;
  if (child.startsWith("/")) return child;
  if (child === "" || child === "*") return `${prefix}/*`;
  return `${prefix}/${child}`;
}

function collectRoutePatterns(files, routeConsts) {
  const patterns = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const prefix = SHELL_PREFIXES[file] ?? "";
    const filePatterns = extractRoutesFromSource(src, prefix, routeConsts);
    for (const p of filePatterns) patterns.add(p);
    // For shell files, also register the bare prefix itself — the shell's
    // top-level <Routes> renders an index/overview at e.g. `/desk` even
    // though no <Route path="/desk"> is declared anywhere.
    if (prefix) patterns.add(prefix);
  }
  return patterns;
}

// ── Link target extraction ─────────────────────────────────────────────────
// Captures literal string targets only. Template literals and expressions
// are ignored (we cannot reliably resolve them at build time).
const LINK_TO_RE = /\b(?:Link|NavLink|Navigate)\b[^>]*?\bto\s*=\s*"([^"]+)"/g;
const NAVIGATE_FN_RE = /\bnavigate\s*\(\s*"([^"]+)"\s*[,)]/g;

function collectLinkTargets(files) {
  const targets = []; // { file, line, target }
  for (const file of files) {
    // The route guard itself, redirect helpers, and the legacy redirect
    // catalogue intentionally reference paths that may not exist (legacy
    // bookmarks that we redirect FROM). Skip the App router file's
    // <Navigate to=...> entries — those targets are handled by the route
    // patterns themselves and any typo there will produce a runtime 404
    // we cover separately.
    const src = readFileSync(file, "utf8");

    let m;
    LINK_TO_RE.lastIndex = 0;
    while ((m = LINK_TO_RE.exec(src)) !== null) {
      const target = m[1];
      if (!isCheckable(target)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      targets.push({ file, line, target });
    }

    NAVIGATE_FN_RE.lastIndex = 0;
    while ((m = NAVIGATE_FN_RE.exec(src)) !== null) {
      const target = m[1];
      if (!isCheckable(target)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      targets.push({ file, line, target });
    }
  }
  return targets;
}

function isCheckable(target) {
  // Only static, in-app paths. Skip:
  //   - external URLs (http://, mailto:, tel:)
  //   - hash-only links (#section)
  //   - empty / "."
  //   - relative paths (no leading slash) — these are router-relative and
  //     we'd need full nesting context to resolve them, which is out of
  //     scope for a lint-style guard.
  if (!target) return false;
  if (target.startsWith("http://") || target.startsWith("https://")) return false;
  if (target.startsWith("mailto:") || target.startsWith("tel:")) return false;
  if (target.startsWith("#")) return false;
  if (!target.startsWith("/")) return false;
  return true;
}

// ── Matching ───────────────────────────────────────────────────────────────
function normalise(target) {
  // Strip query string and hash before matching.
  return target.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

function patternToRegex(pattern) {
  // Convert React-Router path syntax to a regex.
  //   :param      → [^/]+
  //   *           → .*
  //   trailing /* → (/.*)?
  // We're intentionally lenient: the goal is to flag obvious typos, not
  // emulate React Router's matcher byte-for-byte.
  let p = pattern.replace(/\/+$/, "") || "/";
  let re = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metas (but not * and :)
    .replace(/:\w+/g, "[^/]+")
    .replace(/\/\*$/, "(?:/.*)?")
    .replace(/\*/g, ".*");
  return new RegExp(`^${re}$`);
}

function buildMatcher(patterns) {
  // Strip catch-alls that would defeat the check:
  //   - The top-level "*" route renders <NotFound>, so anything matching it
  //     is by definition a 404.
  //   - The shell mount points (e.g. <Route path="/desk/*">) would otherwise
  //     swallow `/desk/typo`. Their legitimate nested children are already
  //     in the pattern set under their full path.
  const shellCatchAlls = new Set(
    Object.values(SHELL_PREFIXES).map((p) => `${p}/*`),
  );
  const effective = [...patterns].filter(
    (p) => p !== "*" && !shellCatchAlls.has(p),
  );
  const compiled = effective.map((p) => ({ pattern: p, re: patternToRegex(p) }));
  return (target) => {
    const norm = normalise(target);
    return compiled.some(({ re }) => re.test(norm));
  };
}

// ── Run ────────────────────────────────────────────────────────────────────
const files = walk(ROOT);
const routeConsts = loadRouteConstants();
const patterns = collectRoutePatterns(files, routeConsts);

if (patterns.size === 0) {
  console.error("[check:routes] FATAL: no <Route> patterns discovered. Refusing to run a vacuous check.");
  process.exit(2);
}

const matches = buildMatcher(patterns);
const targets = collectLinkTargets(files);

const failures = [];
for (const t of targets) {
  if (!matches(t.target)) {
    failures.push(t);
  }
}

if (failures.length > 0) {
  console.error("\n❌ check:routes — broken in-app navigation targets detected:\n");
  for (const f of failures) {
    console.error(`  ${relative(process.cwd(), f.file)}:${f.line}  →  ${f.target}`);
  }
  console.error(
    `\n${failures.length} target(s) point to routes not registered in App.tsx or any nested shell.`,
  );
  console.error(
    "Either register the route, fix the typo, or (if intentional) make the target dynamic so the guard skips it.\n",
  );
  process.exit(1);
}

console.log(
  `✅ check:routes — ${targets.length} static link target(s) verified against ${patterns.size} registered route pattern(s).`,
);
