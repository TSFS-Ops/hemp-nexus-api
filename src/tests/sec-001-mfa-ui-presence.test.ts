/**
 * SEC-001 follow-up — MFA enrolment + challenge UI presence.
 *
 * The repair endpoint `admin-match-legacy-repair` requires AAL2 via
 * `assertAal2`. To produce an AAL2 session, the app must expose a TOTP
 * enrolment + challenge UI. These tests guard that:
 *
 *  1. A Security tab exists in the desk settings layout.
 *  2. It is routed under /desk/settings/security.
 *  3. The component calls the Supabase MFA API (enroll, challenge,
 *     verify, listFactors, getAuthenticatorAssuranceLevel).
 *  4. It renders the QR code and a 6-digit code input.
 *  5. It does NOT log the TOTP secret or persist it to localStorage.
 *  6. It does NOT weaken AAL2 — `assertAal2` still rejects aal1/unknown.
 *  7. It does NOT import POI / WaD / payment / credit / notification
 *     side-effect modules.
 *  8. `MFA_REQUIRED` error copy in the new component points the user to
 *     the Security tab.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const securityTab = read("../components/desk/settings/SecurityTab.tsx");
const tabs = read("../components/desk/settings/SettingsTabs.tsx");
const desk = read("../pages/Desk.tsx");
const aalHelper = read("../../supabase/functions/_shared/aal.ts");
const repair = read("../../supabase/functions/admin-match-legacy-repair/index.ts");

describe("SEC-001 follow-up — MFA UI presence", () => {
  it("Security tab is listed in SettingsTabs", () => {
    expect(tabs).toMatch(/\/desk\/settings\/security/);
    expect(tabs).toMatch(/Security/);
  });

  it("Security route is registered under /desk/settings", () => {
    expect(desk).toMatch(/SecurityTab/);
    expect(desk).toMatch(/path="security"\s+element={<SecurityTab/);
  });

  it("SecurityTab calls the Supabase MFA enrolment API", () => {
    expect(securityTab).toMatch(/supabase\.auth\.mfa\.enroll\(/);
    expect(securityTab).toMatch(/factorType:\s*['"]totp['"]/);
  });

  it("SecurityTab calls challenge + verify for MFA", () => {
    expect(securityTab).toMatch(/supabase\.auth\.mfa\.challenge\(/);
    expect(securityTab).toMatch(/supabase\.auth\.mfa\.verify\(/);
  });

  it("SecurityTab inspects listFactors + current AAL", () => {
    expect(securityTab).toMatch(/supabase\.auth\.mfa\.listFactors\(/);
    expect(securityTab).toMatch(/getAuthenticatorAssuranceLevel\(/);
  });

  it("SecurityTab renders QR and a 6-digit code input", () => {
    expect(securityTab).toMatch(/data-testid="mfa-qr"/);
    expect(securityTab).toMatch(/data-testid="mfa-secret"/);
    expect(securityTab).toMatch(/inputMode="numeric"/);
    expect(securityTab).toMatch(/autoComplete="one-time-code"/);
  });

  it("SecurityTab provides a 'Verify MFA for this session' path for an enrolled user", () => {
    expect(securityTab).toMatch(/Verify MFA for this session/);
    expect(securityTab).toMatch(/challengeExisting/);
  });

  it("SecurityTab does not log or persist the TOTP secret", () => {
    expect(securityTab).not.toMatch(/console\.(log|info|debug|warn|error)[^\n]*secret/i);
    expect(securityTab).not.toMatch(/localStorage[^\n]*secret/i);
    expect(securityTab).not.toMatch(/sessionStorage[^\n]*secret/i);
  });

  it("SecurityTab does not import POI / WaD / payment / credit / notification side-effect modules", () => {
    expect(securityTab).not.toMatch(/from\s+['"][^'"]*\/(poi|wad|payment|credit|notification)[^'"]*['"]/i);
    expect(securityTab).not.toMatch(/atomic_generate_poi/);
    expect(securityTab).not.toMatch(/atomic_token_burn/);
  });

  it("SecurityTab guides the user with MFA_REQUIRED copy", () => {
    expect(securityTab).toMatch(/MFA_REQUIRED/);
  });

  it("SecurityTab does not surface technical AAL1/AAL2 jargon to users", () => {
    // Internal SDK string comparisons use lowercase "aal1"/"aal2" — those
    // are values, not user-facing copy. Uppercase AAL1/AAL2 only ever
    // appeared in rendered labels/toasts, so guard against that form.
    expect(securityTab).not.toMatch(/AAL1/);
    expect(securityTab).not.toMatch(/AAL2/);
    expect(securityTab).not.toMatch(/assurance level/i);
  });
});

describe("SEC-001 follow-up — AAL2 contract preserved", () => {
  it("assertAal2 still fails closed on aal1 / unknown", () => {
    expect(aalHelper).toMatch(/if\s*\(\s*aal\s*===\s*"aal2"\s*\)\s*return/);
    expect(aalHelper).toMatch(/MFA_REQUIRED/);
    expect(aalHelper).toMatch(/403/);
  });

  it("admin-match-legacy-repair still calls assertAal2", () => {
    expect(repair).toMatch(/from\s+['"]\.\.\/_shared\/aal\.ts['"]/);
    expect(repair).toMatch(/await\s+assertAal2\(/);
  });
});
