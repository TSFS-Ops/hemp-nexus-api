import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard: Paystack initialize provider-rejection branch
 * (paystackData.status === false) MUST release the idempotency
 * reservation, mirroring the timeout / network / invalid-JSON
 * release branches. Without this the 202 processing row persists
 * for 24h and same-key retries hit IDEMPOTENCY_REQUEST_IN_PROGRESS.
 *
 * Strictly source-text assertions — no schema, no DB, no provider
 * calls, no balance or ledger mutation in this guard.
 */
const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/token-purchase/index.ts"),
  "utf8",
);

function sliceRejectionBranch(src: string): string {
  const start = src.indexOf("if (!paystackData.status) {");
  expect(start, "rejection branch present").toBeGreaterThan(-1);
  // grab a generous window covering the branch body
  return src.slice(start, start + 1400);
}

describe("Paystack initialize provider-rejection releases idempotency", () => {
  const branch = sliceRejectionBranch(SRC);

  it("DELETEs the idempotency reservation before returning 400", () => {
    expect(branch).toMatch(/\.from\(["']idempotency_keys["']\)/);
    expect(branch).toMatch(/\.delete\(\)/);
    // delete must appear BEFORE the 400 response
    const delIdx = branch.indexOf(".delete()");
    const respIdx = branch.indexOf("status: 400");
    expect(delIdx).toBeGreaterThan(-1);
    expect(respIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeLessThan(respIdx);
  });

  it("scopes the DELETE by org_id, idempotency_key, and endpoint", () => {
    expect(branch).toMatch(/\.eq\(["']org_id["'],\s*profile\.org_id\)/);
    expect(branch).toMatch(/\.eq\(["']idempotency_key["'],\s*idempotencyKey\)/);
    expect(branch).toMatch(/\.eq\(["']endpoint["'],\s*idempotencyEndpoint\)/);
  });

  it("still returns 400 with provider/providerCode/providerMessage", () => {
    expect(branch).toMatch(/status:\s*400/);
    expect(branch).toMatch(/provider:\s*["']paystack["']/);
    expect(branch).toMatch(/providerCode:/);
    expect(branch).toMatch(/providerMessage:/);
  });

  it("does NOT insert token_purchases, mutate balances, or touch token_ledger in this branch", () => {
    expect(branch).not.toMatch(/token_purchases/);
    expect(branch).not.toMatch(/token_balances/);
    expect(branch).not.toMatch(/token_ledger/);
    expect(branch).not.toMatch(/atomic_paid_credit_purchase/);
  });

  it("timeout/network and invalid-JSON release branches remain intact", () => {
    // timeout/network branch
    expect(SRC).toMatch(/ProviderFetchTimeoutError[\s\S]{0,800}?idempotency_keys[\s\S]{0,200}?\.delete\(\)/);
    // invalid JSON branch
    expect(SRC).toMatch(/invalid JSON[\s\S]{0,400}?idempotency_keys[\s\S]{0,200}?\.delete\(\)/);
  });
});
