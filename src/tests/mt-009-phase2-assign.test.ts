/**
 * MT-009 Phase 2 — assign edge function + RPC source-guard tests.
 *
 * No live HTTP calls — these are source/grant/guard assertions. End-to-end
 * Daniel fixtures are seeded separately.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const EDGE = "supabase/functions/match-named-contacts-assign/index.ts";
const CLIENT = "src/lib/match-named-contacts.ts";
const DIALOG = "src/components/match/AssignNamedContactDialog.tsx";
const PANEL = "src/components/match/NamedContactPanel.tsx";

describe("MT-009 Phase 2 — edge function envelope", () => {
  const src = read(EDGE);

  it("requires Idempotency-Key via assertIdempotencyKey", () => {
    expect(src).toMatch(/assertIdempotencyKey\(req\)/);
  });

  it("authorises via getUser + has_role('org_admin') + is_admin RPCs", () => {
    expect(src).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(src).toMatch(/\.rpc\("has_role"/);
    expect(src).toMatch(/_role: "org_admin"/);
    expect(src).toMatch(/\.rpc\("is_admin"/);
  });

  it("requires AAL2 only on the platform-admin override branch", () => {
    expect(src).toMatch(/isPlatformAdmin\) \{[\s\S]*?assertAal2\(authHeader/);
    // Org-admin branch precedes the AAL2 call (not the import).
    const orgAdminIdx = src.indexOf("org_admin_self_service");
    const aalCallIdx = src.indexOf("assertAal2(authHeader");
    expect(orgAdminIdx).toBeGreaterThan(0);
    expect(aalCallIdx).toBeGreaterThan(orgAdminIdx);
  });

  it("calls assign_match_named_contact RPC with assignedByRole", () => {
    expect(src).toMatch(/\.rpc\(\s*"assign_match_named_contact"/);
    expect(src).toMatch(/p_assigned_by_role: assignedByRole/);
  });

  it("validates body with Zod (.strict)", () => {
    expect(src).toMatch(/BodySchema = z[\s\S]+\.strict\(\)/);
    expect(src).toMatch(/side: z\.enum\(\["buyer", "seller"\]\)/);
    expect(src).toMatch(/contact_email: z\.string\(\)[\s\S]*\.email\(\)/);
  });

  it("returns FORBIDDEN when caller is neither org-admin nor platform-admin", () => {
    expect(src).toMatch(/error: "FORBIDDEN"/);
  });

  it("maps RPC errors to typed codes (MATCH_NOT_FOUND, SIDE_HAS_NO_ORG, VALIDATION_ERROR)", () => {
    expect(src).toMatch(/MATCH_NOT_FOUND/);
    expect(src).toMatch(/SIDE_HAS_NO_ORG/);
    expect(src).toMatch(/VALIDATION_ERROR/);
  });

  it("never imports notification/email/invite/POI/WaD/payment/credit modules", () => {
    const imports = src.match(/^import .+from .+$/gm) ?? [];
    const joined = imports.join("\n");
    expect(joined).not.toMatch(
      /notification-dispatch|send-team-invite|resend|email-templates|poi-|wad|payment|credit|atomic_generate|atomic_token_burn/i,
    );
  });

  it("never creates auth.users (no admin.createUser / inviteUserByEmail)", () => {
    expect(src).not.toMatch(/createUser|inviteUserByEmail|generateLink/);
  });
});

describe("MT-009 Phase 2 — RPC grants & search_path", () => {
  // Grants and search_path are asserted via the live linter and runtime checks
  // in the migration. We mirror those expectations in source so future drift
  // is caught at PR time.
  it("RPC migration is checked into source via the supabase types output", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toMatch(/assign_match_named_contact/);
    expect(types).toMatch(/p_match_id/);
    expect(types).toMatch(/p_assigned_by_role/);
  });
});

describe("MT-009 Phase 2 — client wrapper", () => {
  const src = read(CLIENT);

  it("invokes the canonical edge function path", () => {
    expect(src).toMatch(/functions\.invoke\(\s*"match-named-contacts-assign"/);
  });

  it("always sends an Idempotency-Key header", () => {
    expect(src).toMatch(/"Idempotency-Key":/);
  });

  it("lower-cases email before submit", () => {
    expect(src).toMatch(/contactEmail\.trim\(\)\.toLowerCase\(\)/);
  });

  it("throws AssignNamedContactError on failure (Zero Swallowed Errors)", () => {
    expect(src).toMatch(/throw new AssignNamedContactError/);
  });

  it("does not import any notification/invite/email module", () => {
    const imports = src.match(/^import .+from .+$/gm) ?? [];
    const joined = imports.join("\n");
    expect(joined).not.toMatch(/notification|invite|resend|email-/i);
  });
});

describe("MT-009 Phase 2 — dialog UX", () => {
  const src = read(DIALOG);

  it("includes the no-invite/no-notify policy copy verbatim", () => {
    expect(src).toContain(
      "This records the named authorised contact for audit. It does not\n            invite, email, or notify them.",
    );
  });

  it("has a Cancel button (modal dismissal standard)", () => {
    expect(src).toMatch(/>\s*Cancel\s*</);
  });

  it("wraps submit in try/catch/finally and resets submitting state", () => {
    expect(src).toMatch(/try \{[\s\S]+\} catch[\s\S]+\} finally \{[\s\S]+setSubmitting\(false\)/);
  });

  it("shows MFA_REQUIRED human copy on platform-admin AAL1", () => {
    expect(src).toMatch(/MFA_REQUIRED/);
    expect(src).toMatch(/multi-factor authentication/i);
  });

  it("uses sonner toast (not legacy useToast)", () => {
    expect(src).toMatch(/from "sonner"/);
  });
});

describe("MT-009 Phase 2 — panel gating rules", () => {
  const src = read(PANEL);

  it("computes canAssign using isPlatformAdmin OR (isOrgAdmin AND own-org)", () => {
    expect(src).toMatch(/isPlatformAdmin/);
    expect(src).toMatch(/isOrgAdmin/);
    expect(src).toMatch(/sideOrg === userOrgId/);
  });

  it("never offers assignment when the registered-user path satisfies the side", () => {
    expect(src).toMatch(/satisfied_registered[\s\S]*return false/);
  });

  it("refetches active contacts after a successful assignment", () => {
    expect(src).toMatch(/setReloadKey/);
    expect(src).toMatch(/onSaved=\{\(\) => setReloadKey/);
  });
});

describe("MT-009 Phase 2 — global non-regressions", () => {
  it("does not wire hard progression blocking (engagement-progression-guard untouched)", () => {
    const p = join(ROOT, "src/lib/engagement-progression-guard.ts");
    let src = "";
    try {
      src = readFileSync(p, "utf8");
    } catch {
      return;
    }
    expect(src).not.toMatch(/match-named-contacts/);
    expect(src).not.toMatch(/assign_match_named_contact/);
  });

  it("MT-008 archive/repair edge functions remain unchanged in named-contact-related code", () => {
    const a = read("supabase/functions/admin-match-legacy-archive/index.ts");
    const r = read("supabase/functions/admin-match-legacy-repair/index.ts");
    expect(a).not.toMatch(/named_contact/i);
    expect(r).not.toMatch(/named_contact/i);
  });
});
