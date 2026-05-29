/**
 * Batch 4 — Deno tests for org-sso-test-connection validation.
 *
 * The HTTP serve handler enforces RBAC, AAL2, and the
 * `supabase_sso_provider_id IS NOT NULL` gate. Those are integration-tested
 * via the staging operator run. Here we lock the body contract.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BodySchema } from "./validation.ts";

const ORG = "11111111-1111-1111-1111-111111111111";

Deno.test("test-connection BodySchema — empty body parses (org_admin defaults to own org)", () => {
  const r = BodySchema.safeParse({});
  assert(r.success);
  assertEquals(r.data.org_id, undefined);
});

Deno.test("test-connection BodySchema — org_id uuid parses", () => {
  const r = BodySchema.safeParse({ org_id: ORG });
  assert(r.success);
});

Deno.test("test-connection BodySchema — non-uuid org_id rejected", () => {
  const r = BodySchema.safeParse({ org_id: "abc" });
  assertEquals(r.success, false);
});
