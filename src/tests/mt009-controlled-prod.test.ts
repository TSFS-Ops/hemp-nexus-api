/**
 * Source-pin tests for the MT-009 controlled production demo seeder /
 * unseeder. Style mirrors phase2-daniel-fixtures.test.ts: assertions are
 * against the source text of the edge functions and selected app modules,
 * so they cannot regress without a deliberate edit.
 *
 * These tests prove (without making any HTTP calls):
 *   1. Production seeding is refused when the controlled flag is disabled.
 *   2. Production seeding works only when the flag is enabled AND scope +
 *      hashes match.
 *   3. Only the five MT-009 hashes are accepted.
 *   4. Non-demo rows cannot be created (every match insert forces
 *      is_demo=true plus the metadata envelope).
 *   5. MT-008 (and MT-012) fixtures are explicitly banned by prefix and
 *      never touched.
 *   6. No POI / WaD / payment / credit / token / notification / email /
 *      rating / lifecycle symbols are imported.
 *   7. Hard MT-009 progression guard is not wired anywhere in the gating
 *      SSOT modules.
 *   8. Unseed deletes only the five allowlisted hashes and only where
 *      is_demo=true AND metadata.fixture_scope matches.
 *   9. Expiry guard: max 30 days; default 30 days.
 *  10. Seeder response shape includes the verification fields demanded by
 *      the approved plan.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SEEDER = readFileSync(
  resolve("supabase/functions/seed-mt009-controlled-prod/index.ts"),
  "utf8",
);
const UNSEEDER = readFileSync(
  resolve("supabase/functions/unseed-mt009-controlled-prod/index.ts"),
  "utf8",
);

const ALL_FIVE = [
  "DEMO-MT009-NC-BUYERMISSING-001",
  "DEMO-MT009-NC-SELLERMISSING-002",
  "DEMO-MT009-NC-BOTHMISSING-003",
  "DEMO-MT009-NC-REPLACEBUYER-004",
  "DEMO-MT009-NC-CLEAN-005",
];

describe("MT-009 controlled-prod seeder — scope + allowlist", () => {
  it("declares the exact scope constant", () => {
    expect(SEEDER).toContain('ALLOWED_FIXTURE_SCOPE = "MT-009 Phase 2 Daniel UAT"');
    expect(UNSEEDER).toContain('ALLOWED_FIXTURE_SCOPE = "MT-009 Phase 2 Daniel UAT"');
  });

  it("declares all five — and only the five — MT-009 hashes", () => {
    for (const h of ALL_FIVE) {
      expect(SEEDER).toContain(h);
      expect(UNSEEDER).toContain(h);
    }
    // No other DEMO-MT009 hash should leak in. Quoted occurrences only
    // (skips the JSDoc `["DEMO-MT009-NC-...", ...]` example).
    const otherMt009 = SEEDER.match(/"(DEMO-MT009-[A-Z0-9-]+)"/g) ?? [];
    for (const raw of otherMt009) {
      const m = raw.slice(1, -1);
      expect(ALL_FIVE).toContain(m);
    }
  });

  it("explicitly bans MT-008 and MT-012 prefixes", () => {
    expect(SEEDER).toMatch(/BANNED_HASH_PREFIXES\s*=\s*\[\s*"DEMO-MT008-",\s*"DEMO-MT012-"\s*\]/);
  });

  it("requires the RUN_SEED_MT009_CONTROLLED_PROD confirm token", () => {
    expect(SEEDER).toContain('"RUN_SEED_MT009_CONTROLLED_PROD"');
  });

  it("requires the RUN_UNSEED_MT009_CONTROLLED_PROD confirm token", () => {
    expect(UNSEEDER).toContain('"RUN_UNSEED_MT009_CONTROLLED_PROD"');
  });

  it("requires a runtime password >=12 chars and never hardcodes one", () => {
    expect(SEEDER).toMatch(/password\.length\s*<\s*12/);
    expect(SEEDER).not.toMatch(/password:\s*"[A-Za-z0-9!@#$%^&*]{12,}"/);
  });
});

describe("MT-009 controlled-prod seeder — production gating", () => {
  it("reads admin_settings.allow_controlled_production_demo_fixtures", () => {
    expect(SEEDER).toContain('"allow_controlled_production_demo_fixtures"');
    expect(UNSEEDER).toContain('"allow_controlled_production_demo_fixtures"');
  });

  it("refuses production seeding when the controlled flag is disabled", () => {
    expect(SEEDER).toMatch(/if\s*\(\s*isProductionTier\(\)\s*\)/);
    expect(SEEDER).toContain('"CONTROLLED_PRODUCTION_FLAG_DISABLED"');
    expect(SEEDER).toContain("flag.enabled");
  });

  it("enforces scope equality in production", () => {
    expect(SEEDER).toContain('"CONTROLLED_SCOPE_MISMATCH"');
  });

  it("enforces persisted allowlist intersection in production", () => {
    expect(SEEDER).toContain('"HASH_NOT_IN_PERSISTED_ALLOWLIST"');
  });

  it("unseeder also refuses in production when flag disabled", () => {
    expect(UNSEEDER).toMatch(/isProductionTier\(\)/);
    expect(UNSEEDER).toContain('"CONTROLLED_PRODUCTION_FLAG_DISABLED"');
  });

  it("reuses ENVIRONMENT_TIER as the production signal (no parallel bypass)", () => {
    expect(SEEDER).toContain('Deno.env.get("ENVIRONMENT_TIER")');
    expect(UNSEEDER).toContain('Deno.env.get("ENVIRONMENT_TIER")');
  });
});

describe("MT-009 controlled-prod seeder — match insert invariants", () => {
  it("every match insert forces is_demo=true", () => {
    // The single insert path inside ensureMt009Match must set is_demo:true.
    expect(SEEDER).toMatch(/\.insert\(\s*\{[\s\S]{0,800}is_demo:\s*true/);
  });

  it("refuses to mutate an existing non-demo row", () => {
    expect(SEEDER).toMatch(/refusing to mutate non-demo production row/);
  });

  it("stamps the full metadata envelope on every fixture", () => {
    for (const key of [
      "demo_fixture: true",
      "fixture_scope: ALLOWED_FIXTURE_SCOPE",
      "production_demo_mode: true",
      "seeded_at",
      "seeded_by",
      "expires_at",
    ]) {
      expect(SEEDER).toContain(key);
    }
  });

  it("named-contact rows also carry production_demo_mode metadata", () => {
    expect(SEEDER).toMatch(
      /match_named_contacts[\s\S]{0,800}production_demo_mode:\s*true/,
    );
  });

  it("limits accounts to @test.izenzo.co.za (no new auth users beyond Daniel)", () => {
    expect(SEEDER).toContain('@test.izenzo.co.za');
    expect(SEEDER).toMatch(/TEST_EMAIL_SUFFIX\s*=\s*"@test\.izenzo\.co\.za"/);
    expect(SEEDER).toMatch(/not allowed.*must end with.*TEST_EMAIL_SUFFIX/);
    // Allowed account list must be exactly the three Daniel emails.
    const emails = (SEEDER.match(/daniel-[a-z]+@test\.izenzo\.co\.za/g) ?? []);
    const uniq = [...new Set(emails)].sort();
    expect(uniq).toEqual([
      "daniel-counterparty@test.izenzo.co.za",
      "daniel-initiator@test.izenzo.co.za",
      "daniel-platformadmin@test.izenzo.co.za",
    ]);
  });
});

describe("MT-009 controlled-prod seeder — zero side effects", () => {
  // The function must not touch any of these tables / domains. We assert
  // by absence of their identifiers. (`token_ledger` etc. would only ever
  // appear if a maintainer wired billing/POI/WaD side effects into this
  // file — exactly the regression we want to catch.)
  const FORBIDDEN_TABLES = [
    "poi_engagements",
    "poi_drafts",
    "wads",
    "wad_attestations",
    "token_ledger",
    "credit_purchases",
    "payments",
    "notifications",
    "notification_dispatch",
    "email_queue",
    "email_send_log",
    "counterparty_ratings",
    "lifecycle_jobs",
  ];
  for (const t of FORBIDDEN_TABLES) {
    it(`never references the ${t} table`, () => {
      expect(SEEDER).not.toContain(`"${t}"`);
      expect(UNSEEDER).not.toContain(`"${t}"`);
    });
  }

  const FORBIDDEN_FUNCTIONS = [
    "atomic_generate_poi_v2",
    "atomic_token_burn",
    "atomic_accept_bind",
    "notification-dispatch",
    "send-team-invite",
    "poi-engagements",
  ];
  for (const f of FORBIDDEN_FUNCTIONS) {
    it(`never references ${f}`, () => {
      expect(SEEDER).not.toContain(f);
      expect(UNSEEDER).not.toContain(f);
    });
  }
});

describe("MT-009 controlled-prod seeder — expiry guard", () => {
  it("hard-caps expiry at 30 days from now", () => {
    expect(SEEDER).toMatch(/MAX_EXPIRY_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(SEEDER).toContain('"EXPIRY_TOO_LONG"');
  });

  it("defaults expiry to now + 30 days when not supplied", () => {
    expect(SEEDER).toMatch(/expiresAtMs\s*=\s*now\s*\+\s*MAX_EXPIRY_MS/);
  });
});

describe("MT-009 controlled-prod seeder — response verification fields", () => {
  // The per-fixture result returned to the operator must include all six
  // fields required by the approved plan addition #2.
  for (const field of [
    "fixture_hash",
    "match_id",
    "route",
    "created_or_reused",
    "active_named_contact_count",
    "requires_named_contact",
  ]) {
    it(`returns ${field} per fixture`, () => {
      expect(SEEDER).toContain(field);
    });
  }

  it("route is /desk/match/<match_id>", () => {
    expect(SEEDER).toMatch(/route:\s*`\/desk\/match\/\$\{match_id\}`/);
  });
});

describe("MT-009 controlled-prod unseeder — delete hard-gating", () => {
  it("deletes only matches in the allowlist AND is_demo=true AND scope-tag", () => {
    expect(UNSEEDER).toMatch(/\.in\("hash",\s*requested\)/);
    expect(UNSEEDER).toMatch(/\.eq\("is_demo",\s*true\)/);
    expect(UNSEEDER).toMatch(/m\.fixture_scope\s*===\s*ALLOWED_FIXTURE_SCOPE/);
  });

  it("never deletes auth users / orgs / profiles", () => {
    expect(UNSEEDER).not.toContain('auth.admin.deleteUser');
    expect(UNSEEDER).not.toMatch(/from\("organizations"\)[\s\S]{0,80}\.delete/);
    expect(UNSEEDER).not.toMatch(/from\("profiles"\)[\s\S]{0,80}\.delete/);
    expect(UNSEEDER).not.toMatch(/from\("user_roles"\)[\s\S]{0,80}\.delete/);
  });

  it("uses count:'exact' so the operator response is provable", () => {
    expect(UNSEEDER).toContain('count: "exact"');
  });

  it("audits demo.fixture_unseeded_controlled_production", () => {
    expect(UNSEEDER).toContain('"demo.fixture_unseeded_controlled_production"');
  });
});

describe("MT-009 controlled-prod seeder — audit", () => {
  it("audits the controlled-production seed run", () => {
    expect(SEEDER).toContain('"demo.fixture_seeded_controlled_production"');
    expect(SEEDER).toContain('"demo.fixture_seed_refused_controlled_production"');
  });
});

describe("MT-009 controlled-prod — no hard progression block is wired", () => {
  // The plan explicitly forbids wiring hard MT-009 progression blocking.
  // Source-pin: the gating SSOT modules must not gate on MT-009 fixture
  // scope or the allow_controlled_production_demo_fixtures flag.
  const FILES = [
    "src/lib/match-state.ts",
    "src/lib/wad-state.ts",
    "src/lib/engagement-state.ts",
  ];
  for (const f of FILES) {
    it(`${f} does not gate on MT-009 controlled-prod metadata`, () => {
      if (!existsSync(resolve(f))) return; // tolerated for forward-compat
      const src = readFileSync(resolve(f), "utf8");
      expect(src).not.toContain("MT-009 Phase 2 Daniel UAT");
      expect(src).not.toContain("allow_controlled_production_demo_fixtures");
      expect(src).not.toContain("production_demo_mode");
    });
  }
});

describe("MT-009 controlled-prod — does not modify the existing Daniel seeder", () => {
  it("seed-daniel-fixtures production guard is untouched", () => {
    const danielSeeder = readFileSync(
      resolve("supabase/functions/seed-daniel-fixtures/index.ts"),
      "utf8",
    );
    expect(danielSeeder).toContain('"SEED_PRODUCTION_REFUSED"');
    // The Daniel seeder must NOT learn about the controlled-prod flag —
    // it stays a non-production-only path.
    expect(danielSeeder).not.toContain("allow_controlled_production_demo_fixtures");
  });
});
