import { expect, test } from "@playwright/test";
import { loginAsRequesterTrader } from "../helpers/auth-roles";

test("/desk unified register shows strong counterparty/register match and audits propose-link", async ({ page }) => {
  await page.route("**/functions/v1/search", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [{
        id: "11111111-1111-4111-8111-111111111111",
        title: "Acme Trading (Pty) Ltd",
        description: "Jurisdiction: ZA · Reg: 2024/123456/07",
        url: "#",
        source: "counterparty_registry",
        score: 0.9,
        isEnriched: false,
        enrichmentReason: null,
        whySurfaced: "Matched from counterparty registry",
        coherence: { score: 0.95, passed: true, factors: ["Product match"] },
        metadata: { jurisdiction: "ZA", registration_number: "2024/123456/07" },
      }],
      metrics: { baselineCount: 1, enrichedCount: 0, upliftPct: 0, enrichmentReasons: {} },
      parsedQuery: { product: "cashew", location: "ZA", role: "buyer" },
    }),
  }));
  await page.route("**/functions/v1/registry-counterparty-link-suggestions", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      suggestions: [{
        state: "candidate_match",
        counterparty: { id: "11111111-1111-4111-8111-111111111111", name: "Acme Trading (Pty) Ltd", countryCode: "ZA", registrationNumber: "2024/123456/07" },
        registry: { id: "22222222-2222-4222-8222-222222222222", name: "Acme Trading Limited", countryCode: "ZA", registrationNumber: "2024/123456/07" },
        score: 96,
        breakdown: { nameSimilarity: 100, registrationNumberMatch: "match", countryRule: "match", legalFormRule: "missing" },
      }],
      next_cursor: null,
    }),
  }));
  await page.route("**/functions/v1/registry-counterparty-link-propose", async (route) => {
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    const body = route.request().postDataJSON();
    expect(body.registry_company_record_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(body.counterparty_id).toBe("11111111-1111-4111-8111-111111111111");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: { claim_id: "33333333-3333-4333-8333-333333333333" } }) });
  });

  await loginAsRequesterTrader(page);
  await page.goto("/desk/discover");
  await page.getByLabel("Search counterparties and the company register").fill("Acme cashew ZA");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByTestId("suggestion-candidate-match")).toContainText("Acme Trading");
  await expect(page.getByTestId("match-confidence-breakdown")).toContainText("Name 100%");
  await page.getByRole("button", { name: /Propose link/ }).click();
  await expect(page).toHaveURL(/\/registry\/claims\/33333333-3333-4333-8333-333333333333/);
});

test("/desk unified register routes counterparty-only hits into registry request prefill", async ({ page }) => {
  await page.route("**/functions/v1/search", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [{ id: "web-1", title: "Solo Counterparty Ltd", description: "Jurisdiction: ZA", url: "#", source: "web", score: 0.7, isEnriched: true, enrichmentReason: null, whySurfaced: "Web discovery", coherence: { score: 0.7, passed: true, factors: [] }, metadata: { jurisdiction: "ZA" } }],
      metrics: { baselineCount: 1, enrichedCount: 1, upliftPct: 100, enrichmentReasons: {} },
      parsedQuery: { product: "cashew", location: "ZA", role: "buyer" },
    }),
  }));
  await page.route("**/functions/v1/registry-counterparty-link-suggestions", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, suggestions: [{ state: "counterparty_only", counterparty: { id: "web-1", name: "Solo Counterparty Ltd", countryCode: "ZA" }, score: 0, breakdown: null }], next_cursor: null }),
  }));

  await loginAsRequesterTrader(page);
  await page.goto("/desk/discover");
  await page.getByLabel("Search counterparties and the company register").fill("Solo cashew ZA");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByTestId("suggestion-counterparty-only")).toContainText("Solo Counterparty Ltd");
  await page.getByRole("link", { name: /Propose registry record/ }).click();
  await expect(page).toHaveURL(/\/registry\/new-company-request/);
  await expect(page.locator("#cn")).toHaveValue("Solo Counterparty Ltd");
});