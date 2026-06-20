/**
 * Batch 3 — Public Company Search, Company Profile Shell, Claim Your Company.
 * Static / structural proofs only (no live DB calls). Wired through vitest
 * batch suite presence guard via the filename glob.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tsClaims = readFileSync("src/lib/registry-claims.ts", "utf8");
const denoClaims = readFileSync("supabase/functions/_shared/registry-claims.ts", "utf8");
const claimEdge = readFileSync("supabase/functions/registry-company-claim/index.ts", "utf8");
const searchEdge = readFileSync("supabase/functions/registry-company-search/index.ts", "utf8");
const profileEdge = readFileSync("supabase/functions/registry-company-profile/index.ts", "utf8");
const adminClaims = readFileSync("src/pages/admin/registry/Claims.tsx", "utf8");
const claimPage = readFileSync("src/pages/registry/Claim.tsx", "utf8");
const profilePage = readFileSync("src/pages/registry/CompanyProfile.tsx", "utf8");
const searchPage = readFileSync("src/pages/registry/Search.tsx", "utf8");

const APPROVAL_COPY = "Approving this claim confirms only that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";

describe("Batch 3 — Public registry search / profile / claim", () => {
  it("claim state list matches between TS and Deno SSOT", () => {
    const re = /REGISTRY_CLAIM_STATES\s*=\s*\[([\s\S]*?)\]/;
    const ts = tsClaims.match(re)?.[1] ?? "";
    const dn = denoClaims.match(re)?.[1] ?? "";
    expect(ts.replace(/\s+/g, "")).toBe(dn.replace(/\s+/g, ""));
  });

  it("audit event names match between TS and Deno SSOT", () => {
    const re = /REGISTRY_CLAIM_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]/;
    expect(tsClaims.match(re)?.[1]?.replace(/\s+/g, "")).toBe(denoClaims.match(re)?.[1]?.replace(/\s+/g, ""));
  });

  it("search result labels match between TS and Deno SSOT", () => {
    const re = /REGISTRY_SEARCH_RESULT_LABELS\s*=\s*\[([\s\S]*?)\]/;
    expect(tsClaims.match(re)?.[1]?.replace(/\s+/g, "")).toBe(denoClaims.match(re)?.[1]?.replace(/\s+/g, ""));
  });

  it("claim edge function emits all canonical audit names", () => {
    const re = /REGISTRY_CLAIM_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]/;
    const names = Array.from((tsClaims.match(re)?.[1] ?? "").matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const sources = `${claimEdge}\n${searchEdge}\n${profileEdge}`;
    for (const n of names) expect(sources).toContain(`"${n}"`);
  });

  it("claim edge function requires acknowledged_not_verification on review", () => {
    expect(claimEdge).toContain("acknowledged_not_verification: z.literal(true)");
  });

  it("claim edge function blocks approve from claim_started", () => {
    expect(claimEdge).toContain("approval_not_allowed_from_state");
  });

  it("approval non-verification copy is present verbatim across required surfaces", () => {
    expect(tsClaims).toContain(APPROVAL_COPY);
    expect(denoClaims).toContain(APPROVAL_COPY);
    expect(claimEdge).toContain("REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY");
    expect(adminClaims).toContain("REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_COPY");
  });

  it("search page renders the readiness banner with shell_ready state", () => {
    expect(searchPage).toContain('state="shell_ready"');
    expect(searchPage).toContain('moduleCode="M002"');
  });

  it("profile page renders the readiness banner and never references raw bank fields", () => {
    expect(profilePage).toContain('state="shell_ready"');
    expect(profilePage).not.toMatch(/\baccount_number\b|\bsort_code\b|\biban\b|\bswift_bic\b|\brouting_number\b/i);
  });

  it("search page never references raw bank fields", () => {
    expect(searchPage).not.toMatch(/\baccount_number\b|\bsort_code\b|\biban\b|\bswift_bic\b|\brouting_number\b/i);
  });

  it("claim page enforces required declarations and consents", () => {
    expect(claimPage).toContain("claim-decl-authority");
    expect(claimPage).toContain("claim-consent-contact");
    expect(claimPage).toContain("claim-consent-evidence");
  });

  it("admin claims surface requires acknowledgement before recording a decision", () => {
    expect(adminClaims).toContain("admin-non-verification-ack");
    expect(adminClaims).toContain("admin-claim-review-submit");
  });

  it("claim status transitions table-mutation trigger string is present in migration", () => {
    // sanity check via grep — only proves the migration directory has the trigger.
    const fs = require("node:fs") as typeof import("node:fs");
    const dirs = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    const joined = dirs.map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    expect(joined).toContain("registry_company_claims_block_status_mutation");
  });

  it("search edge function gates production results behind country coverage", () => {
    expect(searchEdge).toContain("country_not_production_ready");
    expect(searchEdge).toContain("const results: unknown[] = []");
  });

  it("profile edge function returns bank-detail STATUS LABEL only", () => {
    expect(profileEdge).toContain("bank_detail_status_label");
    expect(profileEdge).toContain("raw_bank_details_exposed: false");
  });

  it("claim review decision maps to expected terminal states", () => {
    expect(claimEdge).toContain('if (decision === "approve") return "approved"');
    expect(claimEdge).toContain('if (decision === "reject") return "rejected"');
    expect(claimEdge).toContain('if (decision === "revoke") return "revoked"');
  });
});
