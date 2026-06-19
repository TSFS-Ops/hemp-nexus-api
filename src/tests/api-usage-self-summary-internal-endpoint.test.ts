/**
 * Internal app-authenticated `api-usage-self-summary` edge function.
 *
 * Static contract guards — proves the endpoint shape that the user signed
 * off on:
 *
 *   • Lives under supabase/functions/, NOT under /v1/*.
 *   • JWT-only authentication (no X-API-Key).
 *   • Re-uses get_api_client_usage_summary (existing gated RPC).
 *   • Filters api_clients by the caller's org_id only.
 *   • Scrubs forbidden fields (payloads, full keys, secrets, notes, stacks).
 *   • Public API V1 hard exclusion is NOT touched:
 *       - no /v1/usage/current route in supabase/functions/public-api/index.ts
 *       - no usage entry in the OpenAPI builder
 *       - the documented hard-exclusion comment is preserved verbatim.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const FN_PATH = "supabase/functions/api-usage-self-summary/index.ts";

describe("api-usage-self-summary · internal endpoint", () => {
  it("edge function file exists", () => {
    expect(exists(FN_PATH)).toBe(true);
  });

  it("does NOT live under the Public API V1 surface", () => {
    expect(FN_PATH).not.toMatch(/\/public-api\//);
    expect(FN_PATH).not.toMatch(/\/v1\//);
  });

  it("uses JWT-only auth — never X-API-Key", () => {
    const src = read(FN_PATH);
    expect(src).toMatch(/getClaims\(/);
    expect(src).toMatch(/Bearer /);
    expect(src.toLowerCase()).not.toMatch(/x-api-key/);
  });

  it("re-uses the existing gated RPC instead of bespoke usage math", () => {
    const src = read(FN_PATH);
    expect(src).toMatch(/get_api_client_usage_summary/);
  });

  it("constrains api_clients lookup to caller's org_id", () => {
    const src = read(FN_PATH);
    expect(src).toMatch(/from\(["']profiles["']\)/);
    expect(src).toMatch(/from\(["']api_clients["']\)/);
    expect(src).toMatch(/\.eq\(["']org_id["'],\s*orgId\)/);
  });

  it("scrubs forbidden response fields (payloads / keys / secrets / notes)", () => {
    const src = read(FN_PATH);
    for (const f of [
      "request_body",
      "response_body",
      "api_key",
      "key_hash",
      "secret",
      "stack",
      "latest_note",
      "internal_note",
    ]) {
      expect(src, `forbidden field missing from scrub list: ${f}`).toMatch(
        new RegExp(`"${f}"`),
      );
    }
  });

  it("rejects non-GET methods", () => {
    expect(read(FN_PATH)).toMatch(/method_not_allowed/);
  });

  it("returns 403 when caller has no org membership", () => {
    expect(read(FN_PATH)).toMatch(/no_organisation/);
  });

  // ── Public API V1 binding contract is unchanged ─────────────
  it("Public API V1 entrypoint still declares /v1/usage/current as a hard exclusion", () => {
    const v1 = read("supabase/functions/public-api/index.ts");
    expect(v1).toMatch(/no \/v1\/usage\/current/);
  });

  it("Public API V1 OpenAPI builder does NOT advertise a usage endpoint", () => {
    const openapi = read("supabase/functions/_shared/public-api-v1-openapi.ts");
    expect(openapi).not.toMatch(/\/v1\/usage/);
  });

  it("usage helper still pins the binding exclusion comment", () => {
    const usage = read("supabase/functions/_shared/public-api-v1-usage.ts");
    expect(usage).toMatch(/no \/v1\/usage endpoint/);
  });
});
