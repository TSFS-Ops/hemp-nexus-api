#!/usr/bin/env node
/**
 * UI-010 prebuild guard — public-availability-claims scanner.
 *
 * Source of truth: signed Client-Only Decision Form, UI-010.
 *
 * Scans the public-routed surfaces and fails the build if any of the
 * forbidden availability-claim phrases appear in the file's rendered
 * copy. The list mirrors the test in
 * `src/tests/ui-010-public-status-and-availability-claims.test.ts` so
 * both surfaces stay in lockstep.
 *
 * Also asserts:
 *   - `src/pages/Status.tsx` contains the verbatim signed holding string.
 *   - The two canonical UI-010 audit action names are declared in
 *     `src/lib/status-audit.ts`.
 *
 * Admin / auth-gated surfaces (e.g. `src/pages/GovernanceHealth.tsx`,
 * `src/components/developer/DeveloperShell.tsx`, `src/components/admin/
 * SystemStatusBadge.tsx`, `src/components/governance/HealthBoard.tsx`)
 * are intentionally NOT scanned — they are not publicly routable.
 */
import { readFileSync } from "node:fs";

const SIGNED_HOLDING_MESSAGE =
  "Status information is not currently published. Please contact Izenzo support for platform availability queries.";

const PUBLIC_SURFACES = [
  "src/pages/Status.tsx",
  "src/components/landing/HeroStripeGlow.tsx",
  "src/components/PublicHeader.tsx",
  "src/pages/Developers.tsx",
];

// Case-insensitive substring matches. Each entry forbids the literal
// phrase from appearing in any public surface. Keep this list aligned
// with the UI-010 test scanner.
const FORBIDDEN_PHRASES = [
  "SYSTEM: OPERATIONAL",
  "All systems operational",
  "99.9%",
  "99.95%",
  "uptime",
  "real-time platform health",
  "live platform health",
  "degraded service",
  "incident resolved",
];

const errors = [];

// 1. Verbatim signed holding message must appear in Status.tsx.
try {
  const statusSrc = readFileSync("src/pages/Status.tsx", "utf8");
  if (!statusSrc.includes(SIGNED_HOLDING_MESSAGE)) {
    errors.push(
      `src/pages/Status.tsx does not contain the verbatim UI-010 signed holding message:\n  "${SIGNED_HOLDING_MESSAGE}"`,
    );
  }
} catch (err) {
  errors.push(`Could not read src/pages/Status.tsx: ${err.message}`);
}

// 2. Canonical audit action names must exist in src/lib/status-audit.ts.
try {
  const auditSrc = readFileSync("src/lib/status-audit.ts", "utf8");
  for (const name of [
    "status.public_status_publish_blocked",
    "status.admin_health_check_recorded",
  ]) {
    if (!auditSrc.includes(`"${name}"`)) {
      errors.push(
        `src/lib/status-audit.ts is missing the canonical UI-010 audit action name "${name}".`,
      );
    }
  }
} catch (err) {
  errors.push(`Could not read src/lib/status-audit.ts: ${err.message}`);
}

// 3. No forbidden phrase may appear in any public surface.
for (const file of PUBLIC_SURFACES) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch (err) {
    errors.push(`Could not read ${file}: ${err.message}`);
    continue;
  }
  const lower = src.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      errors.push(
        `${file} contains forbidden public-availability claim: "${phrase}". Replace with conservative wording (see UI-010).`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("\n❌ UI-010 public-availability-claims check FAILED:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("");
  process.exit(1);
}

console.log("✅ UI-010 public-availability-claims check passed.");
