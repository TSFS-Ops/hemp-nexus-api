#!/usr/bin/env node
/**
 * Route Guard — fails the build if any in-app navigation target points to a
 * path not registered in the React-Router config.
 *
 * Surfaces scanned:
 *   1. src/**\/*.{ts,tsx}
 *      • <Link to="…"> / <NavLink to="…"> / <Navigate to="…">
 *      • navigate("…") imperative calls
 *   2. supabase/functions/**\/*.ts
 *      • Hardcoded ${SITE_URL}/path-style deep-links inside email templates,
 *        webhook callbacks, and Location: redirects. THIS IS THE BIG ONE —
 *        it closes the hole that lets a notification email ship a 404 link
 *        without anyone noticing until a customer complains. (See the wider
 *        "stringly-typed routing" pattern audit.)
 *
 * Why: the original /desk/settings/identity bug shipped because nothing forced
 * literal route strings to be type-checked, and the same defect class hides
 * inside every edge function that builds a URL with string concatenation.
 *
 * Wired into `npm run build` via `prebuild`. Also exposed standalone as
 * `npm run check:routes` for local iteration.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { collectRoutePatterns, loadRouteConstants, walk } from "./lib/collect-routes.mjs";

// ── Link target extraction (client) ────────────────────────────────────────
const LINK_TO_RE = /\b(?:Link|NavLink|Navigate)\b[^>]*?\bto\s*=\s*"([^"]+)"/g;
const NAVIGATE_FN_RE = /\bnavigate\s*\(\s*"([^"]+)"\s*[,)]/g;

function collectLinkTargets(files) {
  const targets = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const re of [LINK_TO_RE, NAVIGATE_FN_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const target = m[1];
        if (!isCheckable(target)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        targets.push({ file, line, target, kind: "client" });
      }
    }
  }
  return targets;
}

function isCheckable(target) {
  if (!target) return false;
  if (target.startsWith("http://") || target.startsWith("https://")) return false;
  if (target.startsWith("mailto:") || target.startsWith("tel:")) return false;
  if (target.startsWith("#")) return false;
  if (!target.startsWith("/")) return false;
  return true;
}

// ── Edge function URL extraction (server) ──────────────────────────────────
// Catches the exact pattern that ships broken links to users via email:
//   `${SITE_URL}/desk/settings/identity`            ← typo, ships 404
//   `${SITE_URL}/desk/match/${matchId}/confirm`     ← partial match still scanned
//   `${appUrl}/auth/callback`
//   `${PUBLIC_BASE_URL}/desk/...`
//
// We extract the literal portion after the interpolation and validate the
// path prefix. Dynamic segments (${matchId}) are normalised to ":param" so
// the matcher accepts them.
const TEMPLATE_URL_RE =
  /\$\{(?:SITE_URL|APP_URL|appUrl|PUBLIC_BASE_URL|baseUrl|BASE_URL|FRONTEND_URL|publicUrl|siteUrl)\}(\/[^`"'$\s]*)/g;

function walkEdgeFunctions(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkEdgeFunctions(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectEdgeUrls(files) {
  const targets = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    TEMPLATE_URL_RE.lastIndex = 0;
    let m;
    while ((m = TEMPLATE_URL_RE.exec(src)) !== null) {
      let path = m[1];
      // Strip trailing characters that aren't part of the path itself.
      path = path.replace(/[)\];,]+$/, "");
      // Normalise inline ${expr} fragments inside the path to a :param
      // placeholder so the matcher treats them as wildcards.
      path = path.replace(/\$\{[^}]+\}/g, ":param");
      if (!isCheckable(path)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      targets.push({ file, line, target: path, kind: "edge" });
    }
  }
  return targets;
}

// ── Matching ───────────────────────────────────────────────────────────────
function normalise(target) {
  return target.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

function patternToRegex(pattern) {
  let p = pattern.replace(/\/+$/, "") || "/";
  let re = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/:\w+/g, "[^/]+")
    .replace(/\/\*$/, "(?:/.*)?")
    .replace(/\*/g, ".*");
  return new RegExp(`^${re}$`);
}

function buildMatcher(patterns) {
  const SHELL_CATCHALLS = new Set(["/desk/*", "/developer/*", "/hq/*"]);
  const effective = [...patterns].filter((p) => p !== "*" && !SHELL_CATCHALLS.has(p));
  const compiled = effective.map((p) => ({ pattern: p, re: patternToRegex(p) }));
  return (target) => {
    const norm = normalise(target);
    return compiled.some(({ re }) => re.test(norm));
  };
}

// ── Run ────────────────────────────────────────────────────────────────────
const clientFiles = walk("src");
const routeConsts = loadRouteConstants();
const patterns = collectRoutePatterns(clientFiles, routeConsts);

if (patterns.size === 0) {
  console.error("[check:routes] FATAL: no <Route> patterns discovered. Refusing to run a vacuous check.");
  process.exit(2);
}

const matches = buildMatcher(patterns);

const clientTargets = collectLinkTargets(clientFiles);
const edgeFiles = walkEdgeFunctions("supabase/functions");
const edgeTargets = collectEdgeUrls(edgeFiles);
const allTargets = [...clientTargets, ...edgeTargets];

const failures = allTargets.filter((t) => !matches(t.target));

if (failures.length > 0) {
  console.error("\n❌ check:routes — broken navigation targets detected:\n");
  for (const f of failures) {
    const tag = f.kind === "edge" ? " [edge fn]" : "";
    console.error(`  ${relative(process.cwd(), f.file)}:${f.line}${tag}  →  ${f.target}`);
  }
  console.error(
    `\n${failures.length} target(s) point to routes not registered in App.tsx or any nested shell.`,
  );
  console.error(
    "Fix the typo, register the route, or (if intentional) make the target dynamic so the guard skips it.\n",
  );
  process.exit(1);
}

console.log(
  `✅ check:routes — verified ${clientTargets.length} client + ${edgeTargets.length} edge-fn target(s) against ${patterns.size} registered route pattern(s).`,
);
