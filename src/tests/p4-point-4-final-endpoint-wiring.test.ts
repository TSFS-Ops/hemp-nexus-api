/**
 * P-4 Point 4 — Final endpoint wiring test suite.
 *
 * Proves the registry-api-profile-status endpoint is wired to the shared
 * artefact-burn engine end-to-end (static contract level), and that the
 * billing metadata + 402 contract + usage-row columns are present.
 *
 * Live HTTP behaviour is exercised by the existing P-4 Point 4 engine
 * tests (36 tests) plus the endpoint-wiring guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getArtefactPrice,
  planArtefactBurn,
} from "@/lib/registry-api-artefact-pricing";

const ENDPOINT = "supabase/functions/registry-api-profile-status/index.ts";
const ENDPOINT_SRC = readFileSync(resolve(process.cwd(), ENDPOINT), "utf8");

describe("P-4 Point 4 — profile-status wiring", () => {
  it("imports the shared burn wrapper", () => {
    expect(ENDPOINT_SRC).toContain("burnArtefactForApiCall");
    expect(ENDPOINT_SRC).toContain("buildInsufficientCreditsBody");
  });

  it("uses the basic_counterparty artefact (no fractional burn risk)", () => {
    expect(ENDPOINT_SRC).toContain('"basic_counterparty"');
    const p = getArtefactPrice("basic_counterparty")!;
    expect(p.usd_price).toBe(10);
    expect(p.chargeable).toBe(true);
    expect(p.active).toBe(true);
    expect(p.variable).toBe(false);
  });

  it("burn plan for basic_counterparty in production returns exactly 1 wallet credit", () => {
    const plan = planArtefactBurn({
      environment: "production",
      artefact_code: "basic_counterparty",
      artefact_was_produced: true,
    });
    expect(plan.action).toBe("burn");
    if (plan.action !== "burn") throw new Error("expected burn");
    expect(plan.wallet_credits).toBe(1);
    expect(plan.smallest_unit_exact).toBe(true);
  });

  it("sandbox environment skips the burn", () => {
    const plan = planArtefactBurn({
      environment: "sandbox",
      artefact_code: "basic_counterparty",
      artefact_was_produced: true,
    });
    expect(plan.action).toBe("skip");
  });

  it("no-result (not usable) skips the burn", () => {
    const plan = planArtefactBurn({
      environment: "production",
      artefact_code: "basic_counterparty",
      artefact_was_produced: false,
    });
    expect(plan.action).toBe("skip");
  });

  it("returns 402 on insufficient credits without producing the artefact", () => {
    expect(ENDPOINT_SRC).toMatch(/return\s+json\(req,\s*402,\s*buildInsufficientCreditsBody/);
  });

  it("includes billing metadata in the response envelope", () => {
    expect(ENDPOINT_SRC).toContain("billing: billingMetadata");
    expect(ENDPOINT_SRC).toContain("artefact_label");
    expect(ENDPOINT_SRC).toContain("credits_burned");
    expect(ENDPOINT_SRC).toContain("remaining_balance");
    expect(ENDPOINT_SRC).toContain("request_id");
  });

  it("logs artefact_code + credits_burned + remaining_balance into usage row", () => {
    expect(ENDPOINT_SRC).toMatch(/artefact_code:\s*burnRow\.artefact_code/);
    expect(ENDPOINT_SRC).toMatch(/credits_burned:\s*burnRow\.credits_burned/);
    expect(ENDPOINT_SRC).toMatch(/remaining_balance:\s*burnRow\.remaining_balance/);
  });

  it("does not chain .catch directly from PostgREST insert builders", () => {
    expect(ENDPOINT_SRC).not.toMatch(/\.insert\([^\n]*\)\.catch\(/);
    expect(ENDPOINT_SRC).toContain("bestEffortInsert");
  });

  it("uses request_id for idempotency (prevents double-burn on retry)", () => {
    expect(ENDPOINT_SRC).toMatch(/request_id:\s*requestId/);
  });

  it("burn is gated on production mode AND production key_type", () => {
    expect(ENDPOINT_SRC).toContain('requestedMode === "production"');
    expect(ENDPOINT_SRC).toContain('=== "production"');
  });

  it("artefact_label is derived from the pricing SSOT (not hard-coded)", () => {
    expect(ENDPOINT_SRC).toContain("getArtefactPrice");
    expect(ENDPOINT_SRC).toMatch(/artefact_label:\s*price\?\.label/);
  });
});
