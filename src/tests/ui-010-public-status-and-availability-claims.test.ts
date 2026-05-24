/**
 * UI-010 — public status and availability-claims guard.
 *
 * Source of truth: signed Client-Only Decision Form, UI-010.
 *
 * Static source-contract tests proving:
 *   1. The public `/status` page contains the verbatim signed holding
 *      message and nothing that claims operational status, uptime,
 *      degraded service, incident resolution, real-time / live status,
 *      or platform availability.
 *   2. The enumerated public surfaces (landing hero, public header,
 *      developers marketing page) contain none of the forbidden
 *      availability-claim phrases.
 *   3. The two canonical audit action names exist in source:
 *        - status.public_status_publish_blocked
 *        - status.admin_health_check_recorded
 *   4. No public subscriber-alert / incident-email / external-status
 *      edge function exists in `supabase/functions/`.
 *   5. The signed holding message exported from Status.tsx matches the
 *      verbatim string mandated by the Decision Form.
 *
 * Admin / auth-gated surfaces (GovernanceHealth, HealthBoard,
 * SystemStatusBadge, DeveloperShell) are intentionally NOT scanned —
 * they live behind RequireAuth and are out of scope per the SoT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SIGNED_HOLDING_MESSAGE =
  "Status information is not currently published. Please contact Izenzo support for platform availability queries.";

const PUBLIC_SURFACES = [
  "src/pages/Status.tsx",
  "src/components/landing/HeroStripeGlow.tsx",
  "src/components/PublicHeader.tsx",
  "src/pages/Developers.tsx",
] as const;

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
] as const;

describe("UI-010 — public /status holding message", () => {
  const statusSrc = read("src/pages/Status.tsx");

  it("contains the verbatim signed UI-010 holding message", () => {
    expect(statusSrc).toContain(SIGNED_HOLDING_MESSAGE);
  });

  it("exports the holding message as a const for reuse", () => {
    expect(statusSrc).toMatch(/UI_010_PUBLIC_STATUS_HOLDING_MESSAGE\s*=\s*/);
  });
});

describe("UI-010 — forbidden public availability claims", () => {
  for (const file of PUBLIC_SURFACES) {
    for (const phrase of FORBIDDEN_PHRASES) {
      it(`${file} must not contain "${phrase}"`, () => {
        const src = read(file).toLowerCase();
        expect(src.includes(phrase.toLowerCase())).toBe(false);
      });
    }
  }
});

describe("UI-010 — canonical audit action constants", () => {
  const auditSrc = read("src/lib/status-audit.ts");

  it("declares status.public_status_publish_blocked", () => {
    expect(auditSrc).toContain('"status.public_status_publish_blocked"');
    expect(auditSrc).toMatch(/STATUS_PUBLIC_STATUS_PUBLISH_BLOCKED/);
  });

  it("declares status.admin_health_check_recorded", () => {
    expect(auditSrc).toContain('"status.admin_health_check_recorded"');
    expect(auditSrc).toMatch(/STATUS_ADMIN_HEALTH_CHECK_RECORDED/);
  });

  it("exposes recordPublicStatusPublishBlocked + recordAdminHealthCheck", () => {
    expect(auditSrc).toMatch(/export function recordPublicStatusPublishBlocked/);
    expect(auditSrc).toMatch(/export function recordAdminHealthCheck/);
  });
});

describe("UI-010 — no public subscriber / incident / external status function", () => {
  // Enumerate every edge-function directory name and assert none of the
  // forbidden public-status patterns appear in the folder names.
  const fnDir = join(ROOT, "supabase", "functions");
  const dirNames = readdirSync(fnDir).filter((n) => {
    try {
      return statSync(join(fnDir, n)).isDirectory();
    } catch {
      return false;
    }
  });

  const FORBIDDEN_FUNCTION_NAME_FRAGMENTS = [
    "public-status",
    "status-publish",
    "status-subscriber",
    "status-subscribe",
    "incident-notify",
    "incident-broadcast",
    "outage-notify",
    "outage-broadcast",
    "external-status",
  ];

  it("no edge-function directory implements a public publishing / subscriber surface", () => {
    const offenders = dirNames.filter((n) =>
      FORBIDDEN_FUNCTION_NAME_FRAGMENTS.some((f) => n.toLowerCase().includes(f)),
    );
    expect(offenders).toEqual([]);
  });
});
