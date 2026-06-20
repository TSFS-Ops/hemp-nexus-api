/**
 * POI Verification Guardrails / Draft-Only Mode — coverage tests.
 *
 * These tests pin the *wiring* contract for the gate:
 *
 *  1. The canonical reason code `POI_ORG_VERIFICATION_REQUIRED` is exported
 *     by the shared legitimacy helper.
 *  2. Every gated edge function imports both helpers (or, for service-role
 *     admin paths, the org legitimacy helper) and references the canonical
 *     reason code.
 *  3. Every "forbidden action" name in the client-approved allowlist
 *     (issue/send/share/notify/expose/export/engage/wad) maps to a gated
 *     backend entrypoint.
 *  4. There is no admin-override branch in `checkOrgLegitimacy` — the gate
 *     does not key on caller role. `platform_admin` calling against an
 *     unverified org receives the same denial as any other user.
 *
 * Behavioural execution against a live edge runtime is out of scope here —
 * the wiring guard prevents regression at build time and the existing
 * `_shared/poi-gate-integration_test.ts` (deno) covers in-runtime behaviour.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");
function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const REQUIRED_CODE = "POI_ORG_VERIFICATION_REQUIRED";

const FULL_GATE = [
  "supabase/functions/pois/index.ts",
  "supabase/functions/poi-transition/index.ts",
  "supabase/functions/poi-engagements/index.ts",
  "supabase/functions/match/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
];

const ORG_GATE_ONLY = [
  "supabase/functions/facilitation-poi-conversion/index.ts",
  "supabase/functions/export-prepare/index.ts",
  "supabase/functions/export-download/index.ts",
];

const FORBIDDEN_ACTION_TO_ENTRYPOINT: Record<string, string[]> = {
  issue: ["supabase/functions/pois/index.ts"],
  send: ["supabase/functions/poi-engagements/index.ts"],
  share: ["supabase/functions/poi-engagements/index.ts"],
  notify: ["supabase/functions/poi-engagements/index.ts"],
  expose: ["supabase/functions/match/index.ts", "supabase/functions/pois/index.ts"],
  export: [
    "supabase/functions/export-prepare/index.ts",
    "supabase/functions/export-download/index.ts",
  ],
  engage: ["supabase/functions/poi-engagements/index.ts"],
  wad: ["supabase/functions/wad/index.ts", "supabase/functions/p3-wad/index.ts"],
  facilitate: ["supabase/functions/facilitation-poi-conversion/index.ts"],
};

describe("POI verification gate — canonical reason code", () => {
  const src = read("supabase/functions/_shared/legitimacy.ts");

  it("exports POI_ORG_VERIFICATION_REQUIRED_CODE with the exact client-required value", () => {
    expect(src).toContain(
      `POI_ORG_VERIFICATION_REQUIRED_CODE = "${REQUIRED_CODE}"`,
    );
  });

  it("exports the canonical user-facing block message that matches the UI banner", () => {
    expect(src).toContain("POI_ORG_VERIFICATION_REQUIRED_MESSAGE");
    expect(src).toMatch(/Verification required before issuing POI\./);
    expect(src).toMatch(/internal draft/i);
  });

  it("exports poiGateBlockedAuditMetadata helper for audit row coherence", () => {
    expect(src).toContain("poiGateBlockedAuditMetadata");
    expect(src).toContain("reason_code: POI_ORG_VERIFICATION_REQUIRED_CODE");
  });
});

describe("POI verification gate — server wiring coverage", () => {
  it.each(FULL_GATE)("%s wires the org + user POI authority gates and the canonical reason code", (path) => {
    const src = read(path);
    expect(src).toContain("checkOrgLegitimacy");
    expect(src).toContain("checkUserPoiAuthority");
    expect(src).toContain(REQUIRED_CODE);
  });

  it.each(ORG_GATE_ONLY)("%s wires the org legitimacy gate and the canonical reason code", (path) => {
    const src = read(path);
    expect(src).toContain("checkOrgLegitimacy");
    expect(src).toContain(REQUIRED_CODE);
  });
});

describe("POI verification gate — forbidden-action allowlist coverage", () => {
  it.each(Object.entries(FORBIDDEN_ACTION_TO_ENTRYPOINT))(
    "forbidden action `%s` maps to gated entrypoint(s)",
    (_action, entrypoints) => {
      for (const path of entrypoints) {
        const src = read(path);
        expect(src).toContain("checkOrgLegitimacy");
        expect(src).toContain(REQUIRED_CODE);
      }
    },
  );
});

describe("POI verification gate — no admin override", () => {
  it("checkOrgLegitimacy does NOT branch on platform_admin / role-based override", () => {
    const src = read("supabase/functions/_shared/legitimacy.ts");
    // The legitimacy helper must never accept a "caller role" parameter or
    // contain a code path that returns `allowed: true` based on role.
    expect(src).not.toMatch(/platform_admin/i);
    expect(src).not.toMatch(/admin.?override/i);
  });

  it("checkUserPoiAuthority is the only role-aware gate, and membership alone is rejected", () => {
    const src = read("supabase/functions/_shared/poi-authority.ts");
    expect(src).toContain("USER_NOT_AUTHORISED_CODE");
    // Plain org_member must not be in the issuer allowlist.
    const allowlistBlock = src.match(/ISSUER_ROLES\s*=\s*new Set\(\[([\s\S]*?)\]/);
    expect(allowlistBlock).toBeTruthy();
    expect(allowlistBlock?.[1]).not.toMatch(/"org_member"/);
  });
});

describe("POI verification gate — client UI parity", () => {
  it("VerificationRequiredBanner uses the canonical wording family", () => {
    const src = read("src/components/match/VerificationRequiredBanner.tsx");
    expect(src).toMatch(/Verification required before issuing POI/);
    expect(src).toMatch(/internal draft/i);
  });

  it("DraftPoiBadge renders the three mandatory labels", () => {
    const src = read("src/components/match/DraftPoiBadge.tsx");
    expect(src).toMatch(/Internal draft only/);
    expect(src).toMatch(/Not issued/);
    expect(src).toMatch(/Organisation verification (?:is )?required before/i);
  });
});
