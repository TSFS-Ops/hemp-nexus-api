/**
 * Point 6 — No-credit guard verification.
 *
 * Current state of supabase/functions/public-api/index.ts: every handler
 * sets `ctx.billable = false`. The single chargeable engine
 * (`burnArtefactForApiCall`) already returns
 * `blocked_insufficient_credits` with HTTP 402 and a safe envelope when
 * the wallet cannot cover the cost. This guard pins both invariants so a
 * future batch that flips `ctx.billable = true` cannot ship without also
 * invoking the burn helper in the same route file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Point 6 · no-credit enforcement guard", () => {
  const burn = read("supabase/functions/_shared/api-artefact-burn.ts");
  const routes = read("supabase/functions/public-api/index.ts");

  it("burn helper returns 402 + INSUFFICIENT_CREDITS on block", () => {
    expect(burn).toMatch(/status:\s*"blocked_insufficient_credits"/);
    expect(burn).toMatch(/http_status:\s*402/);
    expect(burn).toMatch(/INSUFFICIENT_CREDITS/);
  });

  it("burn helper does NOT burn on the blocked path", () => {
    // The blocked branch must come from data?.success === false BEFORE any
    // commit; the helper returns immediately with credits_burned undefined.
    const blockedBlock = burn.match(/if \(!data\?\.success\)[\s\S]*?\}/);
    expect(blockedBlock).toBeTruthy();
    expect(blockedBlock![0]).not.toMatch(/credits_burned:/);
  });

  it("every public-api handler that flips billable=true must also call the burn helper", () => {
    // Today: no chargeable route is active. If a future edit sets
    // `ctx.billable = true` without `burnArtefactForApiCall`, this guard
    // fails — preventing chargeable routes from shipping unguarded.
    const flips = routes.match(/ctx\.billable\s*=\s*true/g) ?? [];
    if (flips.length > 0) {
      expect(routes).toMatch(/burnArtefactForApiCall/);
    } else {
      // Sentinel comment must remain so the binding contract is visible.
      expect(routes).toMatch(/production successful lookups WILL set billable=true/);
    }
  });

  it("sandbox handlers are explicitly non-chargeable", () => {
    expect(routes).toMatch(/Sandbox calls are NEVER billable/);
  });

  it("buildInsufficientCreditsBody exposes only safe fields (no balances raw, no internal stack)", () => {
    const body = burn.match(/buildInsufficientCreditsBody[\s\S]*?\}\s*\)/);
    expect(body).toBeTruthy();
    const b = body![0];
    expect(b).toMatch(/code:/);
    expect(b).toMatch(/message:/);
    expect(b).toMatch(/required_credits:/);
    expect(b).toMatch(/available_credits:/);
    expect(b).not.toMatch(/stack|internal|key_hash|secret/i);
  });
});
