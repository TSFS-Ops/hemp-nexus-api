#!/usr/bin/env node

/**
 * Drift Guard - detects layout/footer/back-button drift in page files.
 *
 * Run:  node scripts/check-drift.mjs
 * Or:   npm run check:drift
 *
 * Fails (exit 1) if any page file contains:
 *   1. Raw <footer> markup (must use <PageFooter /> or <PublicPageLayout />)
 *   2. Duplicated "Back to" + ArrowLeft pattern (must use <BackButton />)
 *   3. Page files that bypass the canonical layout wrapper (advisory)
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PAGE_DIR = "src/pages";
const COMPONENT_DIR = "src/components";

// Files that are allowed to contain these patterns (the canonical components themselves)
const ALLOWED_FILES = new Set([
  "src/components/PageFooter.tsx",
  "src/components/PublicPageLayout.tsx",
  "src/components/BackButton.tsx",
  "src/components/PublicHeader.tsx",
  "src/components/ui/section-header.tsx",
  "src/components/ui/error-state.tsx",
  "src/components/ui/inline-loader.tsx",
  "src/components/ui/loading-button.tsx",
  "src/components/ui/match-status-badge.tsx",
  "src/hooks/use-async-action.ts",
  "src/hooks/use-data-fetch.ts",
  "src/lib/api-error-handler.ts",
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

let violations = 0;

function check(file, lineNum, line, rule, message) {
  const rel = relative(".", file);
  if (ALLOWED_FILES.has(rel)) return;
  console.error(`  ❌ ${rel}:${lineNum}  [${rule}] ${message}`);
  violations++;
}

const pageFiles = walk(PAGE_DIR);

for (const file of pageFiles) {
  const rel = relative(".", file);
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const num = i + 1;

    // Rule 1: Raw <footer> tags in page files
    if (/<footer[\s>]/i.test(line)) {
      check(file, num, line, "no-raw-footer", "Use <PageFooter /> or <PublicPageLayout /> instead of raw <footer>");
    }

    // Rule 2: Duplicated back-button pattern (ArrowLeft + "Back to")
    if (/ArrowLeft/.test(line) && /Back to|Back$/.test(lines.slice(Math.max(0, i - 2), i + 3).join(" "))) {
      check(file, num, line, "no-inline-back-button", "Use <BackButton /> instead of inline ArrowLeft + 'Back to…'");
    }
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} drift violation(s) found. Fix them before shipping.\n`);
  process.exit(1);
} else {
  console.log("✅ No drift violations found.");
  process.exit(0);
}
