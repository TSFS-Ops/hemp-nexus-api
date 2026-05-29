/**
 * Batch 4 — Deno tests for org-sso-config validation surface.
 *
 * Covers:
 *  - Valid payloads parse.
 *  - status='live' is REFUSED at the schema layer (extra defence beyond
 *    the DB trigger — the config endpoint must never accept live).
 *  - status='failed' is REFUSED at the schema layer (same reason).
 *  - org_id must be a uuid.
 *  - verified_domains size cap (64).
 *  - metadata_url must be a valid url when supplied.
 *  - certificate_status enum.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PutSchema } from "./validation.ts";

const ORG = "11111111-1111-1111-1111-111111111111";

Deno.test("PutSchema — minimal valid payload (org_id only) parses", () => {
  const r = PutSchema.safeParse({ org_id: ORG });
  assert(r.success, JSON.stringify(r));
});

Deno.test("PutSchema — full valid payload parses", () => {
  const r = PutSchema.safeParse({
    org_id: ORG,
    provider: "saml",
    metadata_url: "https://idp.example.com/metadata.xml",
    verified_domains: ["example.com", "corp.example.com"],
    entity_id: "https://idp.example.com",
    acs_url: "https://x.supabase.co/auth/v1/sso/saml/acs",
    supabase_sso_provider_id: "prov_abc",
    certificate_status: "present",
    status: "configured_not_connected",
  });
  assert(r.success);
});

Deno.test("PutSchema — REFUSES status='live' (only test-connection may promote)", () => {
  const r = PutSchema.safeParse({ org_id: ORG, status: "live" });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — REFUSES status='failed' via config (only test-connection)", () => {
  const r = PutSchema.safeParse({ org_id: ORG, status: "failed" });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — accepts disabled / pending_metadata / configured_not_connected / not_configured", () => {
  for (const s of [
    "not_configured",
    "pending_metadata",
    "configured_not_connected",
    "disabled",
  ]) {
    const r = PutSchema.safeParse({ org_id: ORG, status: s });
    assert(r.success, `status='${s}' should parse`);
  }
});

Deno.test("PutSchema — org_id must be a UUID", () => {
  const r = PutSchema.safeParse({ org_id: "not-a-uuid" });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — verified_domains capped at 64 entries", () => {
  const tooMany = Array.from({ length: 65 }, (_, i) => `d${i}.example.com`);
  const r = PutSchema.safeParse({ org_id: ORG, verified_domains: tooMany });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — metadata_url must be a valid url when supplied", () => {
  const r = PutSchema.safeParse({ org_id: ORG, metadata_url: "not a url" });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — certificate_status enum enforced", () => {
  const r = PutSchema.safeParse({ org_id: ORG, certificate_status: "lol" as never });
  assertEquals(r.success, false);
});

Deno.test("PutSchema — provider='oidc-placeholder' is REJECTED in Batch 4", () => {
  const r = PutSchema.safeParse({ org_id: ORG, provider: "oidc-placeholder" as never });
  assertEquals(r.success, false);
});
