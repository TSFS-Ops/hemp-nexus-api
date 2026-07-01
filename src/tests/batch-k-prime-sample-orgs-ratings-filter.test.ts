import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Batch K′ / tracker #45 — static contract guard.
// Ensures compute-counterparty-ratings excludes demo/sample-fixture
// organisations and matches. No name-based inference. No RLS/grant/schema/
// cron/storage/payment/refund/email changes.

const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/compute-counterparty-ratings/index.ts"),
  "utf8",
);

describe("Batch K′ — sample-only orgs excluded from counterparty ratings (#45)", () => {
  it("bulk enumeration filters is_demo=false and demo_dataset_id IS NULL", () => {
    expect(SRC).toMatch(/\.from\("organizations"\)[\s\S]{0,200}\.eq\("is_demo",\s*false\)[\s\S]{0,120}\.is\("demo_dataset_id",\s*null\)/);
  });

  it("preloads demoOrgIds set from organizations table", () => {
    expect(SRC).toMatch(/demoOrgIds\s*=\s*new Set<string>/);
    expect(SRC).toMatch(/is_demo\.eq\.true,demo_dataset_id\.not\.is\.null/);
  });

  it("computeForOrg accepts demoOrgIds and rejects subject orgs in the set", () => {
    expect(SRC).toMatch(/function computeForOrg\([\s\S]{0,300}demoOrgIds:\s*Set<string>/);
    expect(SRC).toMatch(/demoOrgIds\.has\(orgId\)[\s\S]{0,120}sample_or_demo_org_excluded/);
  });

  it("matches query excludes demo/fixture rows", () => {
    expect(SRC).toMatch(/\.from\("matches"\)[\s\S]{0,600}\.eq\("is_demo",\s*false\)[\s\S]{0,120}\.is\("demo_dataset_id",\s*null\)/);
  });

  it("filters out matches whose counterparty org is a demo fixture", () => {
    expect(SRC).toMatch(/const counterparty\s*=\s*m\.buyer_org_id\s*===\s*orgId\s*\?\s*m\.seller_org_id\s*:\s*m\.buyer_org_id/);
    expect(SRC).toMatch(/!demoOrgIds\.has\(counterparty\)/);
  });

  it("does not use organisation name to infer sample/demo state", () => {
    // No name/like/ilike heuristic on org name.
    expect(SRC).not.toMatch(/\.ilike\(\s*"name"/);
    expect(SRC).not.toMatch(/name.*(sample|demo|fixture|test)/i);
  });

  it("does not introduce broad DELETE of historical ratings/signals", () => {
    // Only the pre-existing per-org, per-methodology_version signal replace remains.
    const deletes = SRC.match(/\.from\("rating_signals"\)\s*\.delete\(\)/g) ?? [];
    expect(deletes.length).toBe(1);
    expect(SRC).not.toMatch(/\.from\("counterparty_ratings"\)\s*\.delete\(\)/);
  });

  it("does not touch RLS/grant/policy/schema/cron/storage/payment/refund/email surfaces", () => {
    expect(SRC).not.toMatch(/GRANT\s+|REVOKE\s+|ALTER\s+POLICY|CREATE\s+POLICY|storage\.objects|paystack|payfast|refund|token_ledger|send-transactional-email|process-email-queue/i);
  });
});
