/**
 * Batch C2 — Public API V1 unrecognised-host gating (item #48).
 *
 * Static-source guards for the changes in
 * supabase/functions/_shared/public-api-v1.ts. These tests do not spin up
 * the edge runtime; they assert the shape of the shipped code so drift is
 * caught in CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const V1 = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/public-api-v1.ts"),
  "utf8",
);

describe("Batch C2 — V1 host gating", () => {
  it("adds unrecognised_host to the V1 error catalogue with 421", () => {
    expect(V1).toMatch(/"unrecognised_host"/);
    expect(V1).toMatch(/unrecognised_host:\s*421/);
  });

  it("keeps canonical hosts as the recognised set", () => {
    expect(V1).toContain("api.trade.izenzo.co.za");
    expect(V1).toContain("api-sandbox.trade.izenzo.co.za");
  });

  it("gates header-derived env behind PUBLIC_API_ALLOW_HEADER_ENV=1", () => {
    expect(V1).toContain('Deno.env.get("PUBLIC_API_ALLOW_HEADER_ENV")');
    expect(V1).toMatch(/PUBLIC_API_ALLOW_HEADER_ENV.*===\s*"1"/s);
  });

  it("exposes hostRecognised and headerOptInUsed on DetectedEnvironment", () => {
    expect(V1).toMatch(/hostRecognised:\s*boolean/);
    expect(V1).toMatch(/headerOptInUsed:\s*boolean/);
  });

  it("runGateway rejects unrecognised hosts with unrecognised_host (not missing_required_field)", () => {
    // Find the runGateway body and assert the new branch is present.
    const gateway = V1.slice(V1.indexOf("export async function runGateway"));
    expect(gateway).toMatch(/throw new V1Error\("unrecognised_host"\)/);
    expect(gateway).toContain("api.v1.unrecognised_host_rejected");
    // Legacy "missing_required_field" for missing env must be gone.
    const firstThrow = gateway.slice(0, gateway.indexOf("// 2. X-API-Key"));
    expect(firstThrow).not.toMatch(/throw new V1Error\("missing_required_field"\)/);
  });

  it("keeps host-derived env authoritative when host is recognised", () => {
    expect(V1).toMatch(/if \(hostEnv\)\s*\{[\s\S]*?env:\s*hostEnv/);
  });

  it("keeps API-key environment check unchanged (host + key must match)", () => {
    expect(V1).toMatch(/key\.environment\s*!==\s*ctx\.environment/);
    expect(V1).toContain('throw new V1Error("production_access_required")');
    expect(V1).toContain('throw new V1Error("sandbox_record_only")');
  });

  it("still stamps X-Izenzo-Environment on error responses (unknown when null)", () => {
    expect(V1).toMatch(/const envHeaderValue = ctx\.environment \?\? "unknown"/);
    expect(V1).toContain('"X-Izenzo-Environment": envHeaderValue');
  });
});
