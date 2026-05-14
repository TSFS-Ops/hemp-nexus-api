/**
 * Phase 2 source-pin tests for the seed-daniel-fixtures edge function.
 *
 * These do NOT call the live function. They assert that the source code
 * preserves the safety invariants we promised in chat:
 *
 *  - Only @test.izenzo.co.za emails are seeded
 *  - Every seeded org / match / engagement is is_demo=true
 *  - The unseeder hard-gates every delete by is_demo=true AND known
 *    name/hash/email allowlist
 *  - Stable fixture identifiers exist for all six demo rows
 *  - Auth requires INTERNAL_CRON_KEY OR service-role OR platform_admin JWT
 *  - Confirm tokens are required
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEEDER = readFileSync(
  resolve("supabase/functions/seed-daniel-fixtures/index.ts"),
  "utf8",
);
const UNSEEDER = readFileSync(
  resolve("supabase/functions/unseed-daniel-fixtures/index.ts"),
  "utf8",
);

describe("Phase 2 — seed-daniel-fixtures invariants", () => {
  it("restricts emails to @test.izenzo.co.za", () => {
    expect(SEEDER).toContain("@test.izenzo.co.za");
    expect(SEEDER).toMatch(/TEST_EMAIL_SUFFIX\s*=\s*"@test\.izenzo\.co\.za"/);
    expect(SEEDER).toMatch(/not allowed.*must end with.*TEST_EMAIL_SUFFIX/);
  });

  it("creates orgs, matches, and engagements as is_demo=true", () => {
    // Org create path explicitly sets is_demo: true
    expect(SEEDER).toMatch(/insert\(\s*\{\s*name,\s*status:\s*"active",\s*is_demo:\s*true\s*\}/);
    // Match insert sets is_demo: true
    expect(SEEDER).toMatch(/match_type:\s*"search",\s*poi_state:\s*"DRAFT",\s*is_demo:\s*true/);
    // Engagement insert sets is_demo: true
    expect(SEEDER).toContain("is_demo: true,");
  });

  it("requires the confirm token RUN_SEED_DANIEL_FIXTURES", () => {
    expect(SEEDER).toContain("RUN_SEED_DANIEL_FIXTURES");
  });

  it("requires a runtime password (>=12 chars), never hardcoded", () => {
    expect(SEEDER).toMatch(/password.*length\s*<\s*12/);
    // No hardcoded password literal of length 12+ in source.
    expect(SEEDER).not.toMatch(/password:\s*"[A-Za-z0-9!@#$%^&*]{12,}"/);
  });

  it("supports INTERNAL_CRON_KEY, service-role, and platform_admin auth", () => {
    expect(SEEDER).toContain("INTERNAL_CRON_KEY");
    expect(SEEDER).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(SEEDER).toMatch(/role:\s*"platform_admin"/);
  });

  it("includes all stable fixture identifiers (Batch D + Batch E)", () => {
    for (const id of [
      "DEMO-BINDING-001",
      "DEMO-DISPUTED-002",
      "DEMO-EMAILCHG-003",
      "DEMO-LATE-ACCEPT-004",
      "DEMO-LATE-RECONFIRM-005",
      "DEMO-CLEAN-006",
      "DEMO-RECONFIRM-DUPLICATE-007",
      // Batch E observability fixtures.
      "DEMO-BE-CONTACT-INCOMPLETE-001",
      "DEMO-BE-EMAIL-MISSING-002",
    ]) {
      expect(SEEDER).toContain(id);
      expect(UNSEEDER).toContain(id);
    }
  });

  it("Batch E fixtures use the contact-incomplete / email-missing shapes", () => {
    // Contact-incomplete: explicit null org link AND null email so
    // getContactState deterministically returns "contact_incomplete".
    expect(SEEDER).toMatch(
      /DEMO-BE-CONTACT-INCOMPLETE-001[\s\S]{0,800}counterparty_org_id:\s*null[\s\S]{0,200}counterparty_email:\s*null/,
    );
    // Email-missing: org link present, named individual contact recorded,
    // counterparty_email is NULL → getContactState returns "email_missing"
    // (not "contact_incomplete") and the initiator UI no longer claims
    // the counterparty name is still required.
    expect(SEEDER).toMatch(
      /DEMO-BE-EMAIL-MISSING-002[\s\S]{0,1200}counterparty_org_id:\s*counterpartyOrgId[\s\S]{0,400}counterparty_email:\s*null[\s\S]{0,400}contact_type:\s*"named_individual"[\s\S]{0,200}contact_name:\s*"DEMO Counterparty Contact"/,
    );
    // The match for fixture 002 must carry a seller_name so the
    // initiator card can render a "Counterparty" label without an email.
    expect(SEEDER).toMatch(
      /DEMO-BE-EMAIL-MISSING-002[\s\S]{0,400}seller_name:\s*"DEMO Counterparty Co\."/,
    );
  });

  it("uses dispute_source='admin_report' for the disputed fixture", () => {
    expect(SEEDER).toMatch(/dispute_source:\s*"admin_report"/);
  });

  it("populates the 3 late-acceptance required timestamps", () => {
    expect(SEEDER).toContain("original_expired_at");
    expect(SEEDER).toContain("late_acceptance_recorded_at");
    expect(SEEDER).toContain("reconfirmation_window_expires_at");
  });

  it("creates a contact_attempt outreach log for the email-change fixture", () => {
    expect(SEEDER).toContain("ensureContactAttemptLog");
    expect(SEEDER).toMatch(/entry_type:\s*"contact_attempt"/);
  });

  it("populates binding_candidates for the binding-review fixture", () => {
    expect(SEEDER).toContain("binding_candidates: [");
  });

  it("upserts profiles and user_roles idempotently", () => {
    expect(SEEDER).toMatch(/from\("profiles"\)\.upsert/);
    expect(SEEDER).toMatch(/from\("user_roles"\)\.upsert/);
    expect(SEEDER).toMatch(/onConflict:\s*"user_id,role"/);
  });

  it("idempotent match lookup by (org_id, hash) before insert", () => {
    expect(SEEDER).toContain("findMatchByHash");
  });

  it("idempotent engagement lookup by (match_id, is_demo=true) before insert", () => {
    expect(SEEDER).toMatch(/from\("poi_engagements"\)[\s\S]{0,200}\.eq\("match_id",\s*shape\.match_id\)[\s\S]{0,80}\.eq\("is_demo",\s*true\)/);
  });
});

describe("Phase 2 — unseed-daniel-fixtures hard-gating", () => {
  it("requires the confirm token RUN_UNSEED_DANIEL_FIXTURES", () => {
    expect(UNSEEDER).toContain("RUN_UNSEED_DANIEL_FIXTURES");
  });

  it("only deletes orgs where is_demo=true AND name IN known demo names", () => {
    expect(UNSEEDER).toMatch(
      /from\("organizations"\)[\s\S]{0,400}\.eq\("is_demo",\s*true\)[\s\S]{0,200}\.in\("name",\s*DEMO_ORG_NAMES\)/,
    );
  });

  it("only deletes matches where is_demo=true AND hash IN known demo hashes", () => {
    expect(UNSEEDER).toMatch(
      /from\("matches"\)[\s\S]{0,400}\.in\("hash",\s*DEMO_MATCH_HASHES\)[\s\S]{0,200}\.eq\("is_demo",\s*true\)/,
    );
  });

  it("only deletes engagements where is_demo=true AND match_id in demo matches", () => {
    expect(UNSEEDER).toMatch(
      /from\("poi_engagements"\)[\s\S]{0,400}\.in\("match_id",\s*demoMatchIds\)[\s\S]{0,200}\.eq\("is_demo",\s*true\)/,
    );
  });

  it("only deletes auth users whose email is in the demo email allowlist", () => {
    expect(UNSEEDER).toContain("DEMO_EMAILS.includes(e)");
    expect(UNSEEDER).toContain('e.endsWith("@test.izenzo.co.za")');
  });

  it("uses count: 'exact' so the response can prove what was removed", () => {
    expect(UNSEEDER).toContain('count: "exact"');
  });
});

describe("Phase 2 — Phase 1 isolation guarantees still in place", () => {
  it("lifecycle-scheduler still skips is_demo rows", () => {
    const src = readFileSync(
      resolve("supabase/functions/lifecycle-scheduler/index.ts"),
      "utf8",
    );
    expect(src).toContain('.eq("is_demo", false)');
  });

  it("outreach-sla-monitor still skips is_demo rows", () => {
    const src = readFileSync(
      resolve("supabase/functions/outreach-sla-monitor/index.ts"),
      "utf8",
    );
    expect(src).toContain('.eq("is_demo", false)');
  });

  it("token-metering still short-circuits demo orgs", () => {
    const src = readFileSync(
      resolve("supabase/functions/_shared/token-metering.ts"),
      "utf8",
    );
    expect(src).toContain("isDemoOrg");
    expect(src).toMatch(/skipped:\s*"demo"/);
  });

  it("batch-d admin/initiator notify still skip is_demo", () => {
    const a = readFileSync(
      resolve("supabase/functions/_shared/batch-d-admin-notify.ts"),
      "utf8",
    );
    const b = readFileSync(
      resolve("supabase/functions/_shared/batch-d-initiator-notify.ts"),
      "utf8",
    );
    expect(a).toContain("is_demo");
    expect(b).toContain("is_demo");
  });

  it("admin engagement panels hide demo rows by default", () => {
    const panel = readFileSync(
      resolve("src/components/admin/AdminPendingEngagementsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("showDemo");
    expect(panel).toMatch(/!showDemo[\s\S]{0,80}is_demo/);
  });
});
