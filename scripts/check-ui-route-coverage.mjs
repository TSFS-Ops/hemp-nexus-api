#!/usr/bin/env node
/**
 * Route-level UI surface coverage guard.
 *
 * Stronger than `check-ui-surface-coverage.mjs`: instead of merely asserting
 * that a Panel / Dashboard / Viewer component is referenced *somewhere* in
 * src/, this guard asserts that it is **reachable from a registered route**
 * via the static import graph.
 *
 * Algorithm
 * ─────────
 *   1. Build an import graph for every .ts/.tsx file under src/.
 *      `@/foo` and relative imports are resolved against the local filesystem.
 *   2. Identify "router roots": every src file that contains `<Route ` JSX.
 *      That set covers App.tsx + every nested shell page (Desk, HQ, etc.).
 *   3. Compute the transitive import closure of the router roots → the set
 *      of files that can actually be rendered for *some* URL.
 *   4. For every exported *Panel / *Dashboard / *Viewer under
 *      src/components/admin and src/components/developer, fail the build if
 *      the file is NOT in that closure.
 *
 * Components that are intentionally not route-reachable (internal helpers,
 * deferred surfaces, cron-key-only viewers) must be listed in
 * scripts/ui-route-coverage-allowlist.json with a short reason. Stale
 * allowlist entries also fail the build.
 *
 * Complements:
 *   • check-ui-surface-coverage.mjs — "is the panel mounted as JSX at all?"
 *   • check-routes.mjs              — "do all <Link to=…> targets exist?"
 * This one closes the third side: "does the mounted panel ride on a route?"
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PANEL_ROOTS = ["src/components/admin", "src/components/developer"];
const SUFFIX_RE = /(Panel|Dashboard|Viewer)$/;
const SRC = "src";

const allowlist = (() => {
  try {
    return JSON.parse(
      readFileSync("scripts/ui-route-coverage-allowlist.json", "utf8"),
    );
  } catch {
    return {};
  }
})();

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Tests never participate in route rendering.
      if (entry === "__tests__" || entry === "test" || entry === "tests")
        continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(SRC);
const fileSet = new Set(allFiles.map((f) => resolve(f)));

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null; // bare module
  let base;
  if (spec.startsWith("@/")) {
    base = resolve("src", spec.slice(2));
  } else {
    base = resolve(dirname(fromFile), spec);
  }
  const candidates = [
    base,
    base + ".tsx",
    base + ".ts",
    base + ".jsx",
    base + ".js",
    join(base, "index.tsx"),
    join(base, "index.ts"),
    join(base, "index.jsx"),
    join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (fileSet.has(resolve(c))) return resolve(c);
  }
  return null;
}

const IMPORT_RE =
  /^\s*(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

const graph = new Map(); // resolved file -> Set(resolved file)
const contents = new Map();
for (const f of allFiles) {
  const abs = resolve(f);
  const src = readFileSync(f, "utf8");
  contents.set(abs, src);
  const deps = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const target = resolveImport(abs, m[1]);
      if (target) deps.add(target);
    }
  }
  graph.set(abs, deps);
}

// Router roots: files that declare a <Route ... /> JSX element.
const routerRoots = [];
for (const [abs, src] of contents) {
  if (/<Route\b/.test(src)) routerRoots.push(abs);
}

// BFS the import closure from the router roots.
const reachable = new Set();
const queue = [...routerRoots];
while (queue.length) {
  const cur = queue.shift();
  if (reachable.has(cur)) continue;
  reachable.add(cur);
  for (const dep of graph.get(cur) ?? []) {
    if (!reachable.has(dep)) queue.push(dep);
  }
}

// Collect candidate panels.
const panelFiles = PANEL_ROOTS.flatMap((r) => walk(r)).filter((f) => {
  const name = f.split("/").pop().replace(/\.tsx$/, "");
  return SUFFIX_RE.test(name);
});

const orphans = [];
const stale = new Set(Object.keys(allowlist));

for (const f of panelFiles) {
  const abs = resolve(f);
  const name = f.split("/").pop().replace(/\.tsx$/, "");
  if (reachable.has(abs)) {
    stale.delete(name);
    continue;
  }
  if (allowlist[name]) {
    stale.delete(name);
    continue;
  }
  orphans.push({ name, file: f });
}

let failed = false;

if (orphans.length) {
  failed = true;
  console.error("❌ Route-level UI surface coverage FAILED:");
  console.error("");
  console.error(
    "These Panel/Dashboard/Viewer components are not reachable from",
  );
  console.error("any registered <Route>. A real user cannot navigate to them:");
  console.error("");
  for (const o of orphans) console.error(`  - ${o.name}  (${o.file})`);
  console.error("");
  console.error("Fix by mounting the component inside a routed page (e.g.");
  console.error("HQ.tsx, DeveloperCenter.tsx, Desk shell tab), OR add an entry");
  console.error("to scripts/ui-route-coverage-allowlist.json explaining why it");
  console.error("is intentionally not route-reachable.");
}

if (stale.size) {
  failed = true;
  console.error("");
  console.error("❌ Stale ui-route-coverage allowlist entries:");
  for (const n of stale) console.error(`  - ${n}`);
  console.error("");
  console.error(
    "These components are now reachable from a route (or have been",
  );
  console.error(
    "deleted). Remove them from scripts/ui-route-coverage-allowlist.json.",
  );
}

if (failed) process.exit(1);

console.log(
  `✅ Route-level UI surface coverage OK — ${panelFiles.length} panels, ${routerRoots.length} router root file(s), ${reachable.size} files in route closure, ${Object.keys(allowlist).length} intentionally internal.`,
);
