#!/usr/bin/env node
/**
 * Operational Visual Token Guard
 *
 * Enforces the institutional flat-panel policy on operational surfaces only.
 * Marketing/public surfaces (landing, pricing, products, solutions, auth,
 * status, public developers) are intentionally out of scope.
 *
 * Forbidden in operational scope (with allowlist):
 *   • rounded-xl, rounded-2xl              (use rounded-md)
 *   • shadow-sm/md/lg/xl/2xl on cards      (flat operational chrome)
 *   • hover:shadow-md, hover:shadow-lg
 *   • bg-gradient-*                        (no marketing gradients)
 *   • Sparkles import outside admin operator tools
 *
 * Allowlist (defensible elevation/affordance):
 *   • Sidebars        — DeskSidebar, GovernorSidebar, AppSidebar
 *   • Drawers         — *Panel.tsx using fixed inset-y drawer pattern
 *   • Popovers/menus  — autocomplete dropdowns, NotificationRulesTab knob
 *   • Wizard steps    — WizardStepper, EngagementTracker, TriageInbox
 *   • Demo/floating   — EvidencePackView demo container + floating toolbar
 *   • Sparkles in     — VerificationWalkthroughCard, TestModeBypassPanel
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "src/components/desk",
  "src/components/match",
  "src/components/admin",
  "src/components/governance",
  "src/components/search",
];
const SCAN_FILES = [
  "src/pages/HQ.tsx",
  "src/pages/Desk.tsx",
  "src/pages/MatchDetails.tsx",
];

// Files that are allowed to use elevation/Sparkles for the documented reason.
const ALLOWLIST_SHADOW = new Set([
  // Sidebars
  "src/components/desk/DeskSidebar.tsx",
  "src/components/governance/GovernorSidebar.tsx",
  // Popover/dropdown surfaces
  "src/components/desk/NewTradeInitiation.tsx",
  // Switch/toggle knob
  "src/components/desk/settings/NotificationRulesTab.tsx",
  // Wizard step indicators
  "src/components/match/wizard/WizardStepper.tsx",
  "src/components/match/EngagementTracker.tsx",
  "src/components/governance/TriageInbox.tsx",
  // Drawer
  "src/components/desk/match/CreditProvisioningPanel.tsx",
  // Demo container + floating toolbar
  "src/components/desk/evidence/EvidencePackView.tsx",
]);

const ALLOWLIST_ROUNDED_XL = new Set([
  // demoMode-only rounded-2xl wrapper
  "src/components/desk/evidence/EvidencePackView.tsx",
]);

const ALLOWLIST_SPARKLES = new Set([
  "src/components/admin/VerificationWalkthroughCard.tsx",
  "src/components/admin/TestModeBypassPanel.tsx",
]);

const FORBIDDEN_PATTERNS = [
  { name: "rounded-xl",       re: /\brounded-xl\b/g,  scope: "rounded" },
  { name: "rounded-2xl",      re: /\brounded-2xl\b/g, scope: "rounded" },
  { name: "shadow-sm",        re: /\bshadow-sm\b/g,   scope: "shadow" },
  { name: "shadow-md",        re: /\bshadow-md\b/g,   scope: "shadow" },
  { name: "shadow-lg",        re: /\bshadow-lg\b/g,   scope: "shadow" },
  { name: "shadow-xl",        re: /\bshadow-xl\b/g,   scope: "shadow" },
  { name: "shadow-2xl",       re: /\bshadow-2xl\b/g,  scope: "shadow" },
  { name: "hover:shadow-md",  re: /hover:shadow-md/g, scope: "shadow" },
  { name: "hover:shadow-lg",  re: /hover:shadow-lg/g, scope: "shadow" },
  { name: "bg-gradient-",     re: /bg-gradient-/g,    scope: "gradient" },
  { name: "Sparkles import",  re: /\bSparkles\b/g,    scope: "sparkles" },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry)) yield p;
  }
}

const targets = new Set();
for (const d of SCAN_DIRS) for (const f of walk(join(ROOT, d))) targets.add(f);
for (const f of SCAN_FILES) targets.add(join(ROOT, f));

const violations = [];
for (const abs of targets) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  const src = readFileSync(abs, "utf8");
  for (const { name, re, scope } of FORBIDDEN_PATTERNS) {
    if (scope === "shadow"   && ALLOWLIST_SHADOW.has(rel))      continue;
    if (scope === "rounded"  && ALLOWLIST_ROUNDED_XL.has(rel))  continue;
    if (scope === "sparkles" && ALLOWLIST_SPARKLES.has(rel))    continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ rel, line, name });
    }
  }
}

if (violations.length) {
  console.error(`\n✗ Operational visual-token guard: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  ${v.name}`);
  console.error(`\n  Policy: rounded-md only, no card shadows, no gradients, no Sparkles outside admin operator tools.`);
  console.error(`  See scripts/check-operational-visual-tokens.mjs for the allowlist.\n`);
  process.exit(1);
}

console.log(`✓ Operational visual-token guard: ${targets.size} files scanned, 0 violations.`);
