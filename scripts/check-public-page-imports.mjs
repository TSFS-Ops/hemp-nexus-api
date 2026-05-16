#!/usr/bin/env node
/**
 * check-public-page-imports.mjs
 *
 * Fails the build if any **public** (anonymous-accessible) page transitively
 * imports admin/authenticated-only chrome:
 *   - @/components/AppSidebar
 *   - @/components/DashboardLayout
 *   - @/components/admin/* (any module under that directory)
 *
 * Rationale: these components assume an authenticated session, an org_id, and
 * RequireAuth wrapping. If a public route pulls them in we risk crashes on
 * the anonymous render path and we leak admin-only bundle weight to logged-out
 * visitors. Lives alongside the other prebuild guards (check-routes,
 * check-edge-function-paths, check-bypass-callsites, etc.).
 *
 * Wired into `npm run prebuild`.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src");

/**
 * Public page entry points = every <Route> in src/App.tsx that is NOT wrapped
 * in <RequireAuth>. Kept explicit so additions/removals are reviewable.
 * Update this list when public routes change in src/App.tsx.
 */
const PUBLIC_PAGE_FILES = [
  "src/pages/Landing.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Welcome.tsx",
  "src/pages/ResetPassword.tsx",
  "src/pages/Docs.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/WalkthroughReport.tsx",
  "src/pages/NotFound.tsx",
  "src/pages/Unsubscribe.tsx",
  "src/pages/Status.tsx",
  "src/pages/Developers.tsx",
  "src/pages/docs/Index.tsx",
  "src/pages/docs/Quickstart.tsx",
  "src/pages/docs/ApiReference.tsx",
  "src/pages/docs/Authentication.tsx",
  "src/pages/docs/Webhooks.tsx",
  "src/pages/docs/Matches.tsx",
  "src/pages/docs/Counterparties.tsx",
  "src/pages/docs/Evidence.tsx",
  "src/pages/docs/Errors.tsx",
  "src/pages/products/TradeDesk.tsx",
  "src/pages/products/ComplianceEngine.tsx",
  "src/pages/products/AuditLedger.tsx",
  "src/pages/solutions/Traders.tsx",
  "src/pages/solutions/Finance.tsx",
  "src/pages/solutions/Sovereigns.tsx",
];

/**
 * Forbidden import predicates. A specifier matches if any returns true.
 * Covers both alias form (@/components/...) and relative form
 * (../../components/...) once resolved against SRC.
 */
const FORBIDDEN = [
  {
    label: "@/components/AppSidebar",
    test: (resolved) => resolved === resolve(SRC, "components/AppSidebar.tsx"),
  },
  {
    label: "@/components/DashboardLayout",
    test: (resolved) =>
      resolved === resolve(SRC, "components/DashboardLayout.tsx"),
  },
  {
    label: "@/components/admin/*",
    test: (resolved) => {
      const adminDir = resolve(SRC, "components/admin") + sep;
      return resolved.startsWith(adminDir);
    },
  },
];

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s*|export\s+(?:[\s\S]*?)\s+from\s*|import\s*\(\s*)["']([^"']+)["']/g;

/** Resolve an import specifier (alias or relative) to an absolute file path on disk. */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) {
    base = resolve(SRC, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = resolve(dirname(fromFile), spec);
  } else {
    // Bare module (react, lucide-react, etc.) — out of scope for this guard.
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
    resolve(base, "index.js"),
    resolve(base, "index.jsx"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function extractImports(source) {
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) out.push(m[1]);
  return out;
}

/**
 * BFS from each public entry point, collecting every transitively reachable
 * local file. Returns Map<importedAbsPath, importerAbsPath[]> for diagnostics.
 */
function walk(entryAbs, violations) {
  const visited = new Set();
  const queue = [entryAbs];
  const parents = new Map(); // file -> first importer (for chain reporting)

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const spec of extractImports(src)) {
      const resolved = resolveSpecifier(spec, file);
      if (!resolved) continue;
      if (!resolved.startsWith(SRC + sep)) continue; // stay inside src/

      // Check forbidden BEFORE descending so the violating import is reported
      // against the file that actually wrote it.
      for (const rule of FORBIDDEN) {
        if (rule.test(resolved)) {
          violations.push({
            entry: entryAbs,
            importer: file,
            specifier: spec,
            resolved,
            rule: rule.label,
          });
        }
      }

      if (!parents.has(resolved)) parents.set(resolved, file);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
}

function main() {
  const violations = [];
  const missing = [];

  for (const rel of PUBLIC_PAGE_FILES) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    walk(abs, violations);
  }

  if (missing.length) {
    console.error(
      "\n[check-public-page-imports] Public page entries listed but not found on disk:",
    );
    for (const m of missing) console.error("  - " + m);
    console.error(
      "Update PUBLIC_PAGE_FILES in scripts/check-public-page-imports.mjs to match src/App.tsx.\n",
    );
    process.exit(2);
  }

  if (violations.length === 0) {
    console.log(
      `[check-public-page-imports] OK · ${PUBLIC_PAGE_FILES.length} public pages, no admin/dashboard imports`,
    );
    return;
  }

  // Group by importer for readable output.
  const byImporter = new Map();
  for (const v of violations) {
    const key = relative(ROOT, v.importer);
    if (!byImporter.has(key)) byImporter.set(key, []);
    byImporter.get(key).push(v);
  }

  console.error(
    "\n[check-public-page-imports] FAIL · public pages must not import admin/authenticated chrome.",
  );
  console.error(
    "Forbidden: @/components/AppSidebar, @/components/DashboardLayout, @/components/admin/*\n",
  );
  for (const [importer, vs] of byImporter) {
    console.error(`  ${importer}`);
    for (const v of vs) {
      const entry = relative(ROOT, v.entry);
      console.error(
        `    └─ imports "${v.specifier}"  (matches ${v.rule})` +
          (importer === entry ? "" : `  · reached from public entry ${entry}`),
      );
    }
  }
  console.error(
    "\nFix: move shared bits into a public-safe module, or gate the admin module behind <RequireAuth>.",
  );
  process.exit(1);
}

main();
