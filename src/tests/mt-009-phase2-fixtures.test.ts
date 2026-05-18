/**
 * MT-009 Phase 2 — Daniel fixture source guards.
 *
 * Source-level (not DB) checks that the seeder/unseeder ship the five
 * MT-009 Phase 2 controlled-named-contact fixtures in the correct shape
 * and that the resulting row metadata flips `requiresNamedContact()` for
 * each fixture as expected.
 *
 * No DB, no React, no edge calls — purely deterministic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  requiresNamedContact,
  type LifecycleMatch,
} from "@/lib/match-lifecycle";

const SEEDER = readFileSync(
  resolve("supabase/functions/seed-daniel-fixtures/index.ts"),
  "utf8",
);
const UNSEEDER = readFileSync(
  resolve("supabase/functions/unseed-daniel-fixtures/index.ts"),
  "utf8",
);

const MT009_CODES = [
  "DEMO-MT009-NC-BUYERMISSING-001",
  "DEMO-MT009-NC-SELLERMISSING-002",
  "DEMO-MT009-NC-BOTHMISSING-003",
  "DEMO-MT009-NC-REPLACEBUYER-004",
  "DEMO-MT009-NC-CLEAN-005",
] as const;

describe("MT-009 Phase 2 — Daniel fixture source guards", () => {
  it("seeder declares all five MT-009 fixture codes in FIXTURES manifest", () => {
    for (const code of MT009_CODES) {
      expect(SEEDER).toContain(`id: "${code}"`);
    }
  });

  it("seeder ships ensureSeededNamedContact helper, gated on is_demo=true", () => {
    expect(SEEDER).toMatch(/async function ensureSeededNamedContact\s*\(/);
    // The helper re-asserts is_demo=true before writing.
    expect(SEEDER).toMatch(
      /ensureSeededNamedContact[\s\S]*?\.eq\("is_demo",\s*true\)/,
    );
    // Uses the constrained assigned_by_role enum.
    expect(SEEDER).toMatch(
      /assigned_by_role:\s*"platform_admin_override"/,
    );
  });

  it("seeder calls ensureSeededNamedContact for each fixture that needs seeded contacts", () => {
    // Buyer-missing seeds seller side only.
    const buyerMissingBlock = SEEDER.match(
      /\/\/ M\. DEMO-MT009-NC-BUYERMISSING-001[\s\S]*?\/\/ N\. DEMO-MT009-NC-SELLERMISSING-002/,
    )?.[0] ?? "";
    expect(buyerMissingBlock).toMatch(/side:\s*"seller"/);
    expect(buyerMissingBlock).not.toMatch(/side:\s*"buyer"/);

    // Seller-missing seeds buyer side only.
    const sellerMissingBlock = SEEDER.match(
      /\/\/ N\. DEMO-MT009-NC-SELLERMISSING-002[\s\S]*?\/\/ O\. DEMO-MT009-NC-BOTHMISSING-003/,
    )?.[0] ?? "";
    expect(sellerMissingBlock).toMatch(/side:\s*"buyer"/);
    expect(sellerMissingBlock).not.toMatch(/side:\s*"seller"/);

    // Both-missing fixture must NOT pre-seed any contact rows.
    const bothBlock = SEEDER.match(
      /\/\/ O\. DEMO-MT009-NC-BOTHMISSING-003[\s\S]*?\/\/ P\. DEMO-MT009-NC-REPLACEBUYER-004/,
    )?.[0] ?? "";
    expect(bothBlock).not.toContain("ensureSeededNamedContact(admin,");

    // Replace fixture seeds buyer (to be replaced) AND seller.
    const replaceBlock = SEEDER.match(
      /\/\/ P\. DEMO-MT009-NC-REPLACEBUYER-004[\s\S]*?\/\/ Q\. DEMO-MT009-NC-CLEAN-005/,
    )?.[0] ?? "";
    expect(replaceBlock).toMatch(/side:\s*"buyer"/);
    expect(replaceBlock).toMatch(/side:\s*"seller"/);

    // Clean control seeds BOTH sides.
    const cleanBlock = SEEDER.match(
      /\/\/ Q\. DEMO-MT009-NC-CLEAN-005[\s\S]*?return json\(\{/,
    )?.[0] ?? "";
    expect(cleanBlock).toMatch(/side:\s*"buyer"/);
    expect(cleanBlock).toMatch(/side:\s*"seller"/);
  });

  it("seeder MT-009 blocks do NOT add MT-008 markers", () => {
    const mt009Block = SEEDER.match(
      /MT-009 Phase 2 — controlled named contact fixtures[\s\S]*?return json\(\{/,
    );
    expect(mt009Block, "expected MT-009 block").not.toBeNull();
    const body = mt009Block![0];
    expect(body).not.toMatch(/legacy_repair_required/);
    expect(body).not.toMatch(/state_reconciliation_required/);
    expect(body).not.toMatch(/legacy_archived_admin_hold/);
  });

  it("seeder MT-009 blocks do NOT touch POI/WaD/payment/credit/notification/lifecycle paths", () => {
    const mt009Block = SEEDER.match(
      /MT-009 Phase 2 — controlled named contact fixtures[\s\S]*?return json\(\{/,
    )![0];
    // Strip line comments and the safety prose so we only assert on
    // executable code (banned words are fine in descriptive comments).
    const code = mt009Block
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code).not.toMatch(/poi_engagements/);
    expect(code).not.toMatch(/ensureEngagement\(/);
    expect(code).not.toMatch(/engagement_outreach_logs/);
    expect(code).not.toMatch(/token_ledger/);
    expect(code).not.toMatch(/\.from\(["']wad_/);
    expect(code).not.toMatch(/\.from\(["']payment/);
    expect(code).not.toMatch(/\.from\(["']notification/);
    expect(code).not.toMatch(/sendEmail|dispatchNotification|notifyOrg/);
  });

  it("unseeder allowlist contains every MT-009 fixture hash and keeps is_demo gate", () => {
    for (const code of MT009_CODES) {
      expect(UNSEEDER).toContain(`"${code}"`);
    }
    expect(UNSEEDER).toMatch(/\.eq\("is_demo",\s*true\)/);
  });

  // ── Predicate-level proof: the five shapes really do flip the gap ──

  type ActiveNC = { side: "buyer" | "seller"; status?: string };

  function bareMatch(): LifecycleMatch {
    return {
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      buyer_org_id: "buyer-org",
      seller_org_id: "seller-org",
      buyer_authorised_user_id: null,
      seller_authorised_user_id: null,
      buyer_contact_user_id: null,
      seller_contact_user_id: null,
      metadata: { demo_fixture: true },
    };
  }

  it("F1 buyer-missing / seller-satisfied → requiresNamedContact === 'buyer'", () => {
    const ncs: ActiveNC[] = [{ side: "seller", status: "active" }];
    expect(requiresNamedContact(bareMatch(), ncs)).toBe("buyer");
  });

  it("F2 seller-missing / buyer-satisfied → requiresNamedContact === 'seller'", () => {
    const ncs: ActiveNC[] = [{ side: "buyer", status: "active" }];
    expect(requiresNamedContact(bareMatch(), ncs)).toBe("seller");
  });

  it("F3 both-missing → requiresNamedContact === 'both'", () => {
    expect(requiresNamedContact(bareMatch(), [])).toBe("both");
  });

  it("F4 replace: buyer has active + seller satisfied → requiresNamedContact === null", () => {
    const ncs: ActiveNC[] = [
      { side: "buyer", status: "active" },
      { side: "seller", status: "active" },
    ];
    expect(requiresNamedContact(bareMatch(), ncs)).toBeNull();
  });

  it("F4 replace: 'replaced' rows do NOT count toward satisfaction", () => {
    const ncs: ActiveNC[] = [
      { side: "buyer", status: "replaced" },
      { side: "seller", status: "active" },
    ];
    expect(requiresNamedContact(bareMatch(), ncs)).toBe("buyer");
  });

  it("F5 clean control: both sides active → requiresNamedContact === null", () => {
    const ncs: ActiveNC[] = [
      { side: "buyer", status: "active" },
      { side: "seller", status: "active" },
    ];
    expect(requiresNamedContact(bareMatch(), ncs)).toBeNull();
  });
});
