/**
 * Batch 4 — Deno tests for org-scim-user-lifecycle pure logic.
 *
 * Covers:
 *  - BodySchema validation (uuid + state enum + reason required).
 *  - Transition matrix matches src/lib/identity/sso-claim.ts.
 *  - auditNameForTransition emits the canonical IDENTITY_AUDIT_NAMES.*.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BodySchema,
  TRANSITIONS,
  auditNameForTransition,
  isValidScimTransition,
  type ScimState,
} from "./transitions.ts";
import { IDENTITY_AUDIT_NAMES } from "../_shared/identity-audit.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

const validBody = (over: Record<string, unknown> = {}) => ({
  org_id: ORG,
  user_id: USER,
  state: "active",
  reason: "Operator validated user.",
  ...over,
});

Deno.test("SCIM BodySchema — valid payload parses", () => {
  const r = BodySchema.safeParse(validBody());
  assert(r.success);
});

Deno.test("SCIM BodySchema — invalid state rejected", () => {
  const r = BodySchema.safeParse(validBody({ state: "exploded" }));
  assertEquals(r.success, false);
});

Deno.test("SCIM BodySchema — reason required (non-empty)", () => {
  const r = BodySchema.safeParse(validBody({ reason: "" }));
  assertEquals(r.success, false);
});

Deno.test("SCIM BodySchema — org_id/user_id must be uuid", () => {
  assertEquals(BodySchema.safeParse(validBody({ org_id: "x" })).success, false);
  assertEquals(BodySchema.safeParse(validBody({ user_id: "y" })).success, false);
});

Deno.test("SCIM transition matrix — every documented transition is allowed", () => {
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    for (const to of tos) {
      assert(
        isValidScimTransition(from as ScimState, to),
        `expected ${from} → ${to} to be allowed`,
      );
    }
  }
});

Deno.test("SCIM transition matrix — no-op transitions blocked", () => {
  for (const s of ["invited", "active", "suspended", "deprovisioned"] as ScimState[]) {
    assertEquals(isValidScimTransition(s, s), false);
  }
});

Deno.test("SCIM transition matrix — deprovisioned cannot leap straight to active", () => {
  assertEquals(isValidScimTransition("deprovisioned", "active"), false);
  assert(isValidScimTransition("deprovisioned", "invited"));
});

Deno.test("auditNameForTransition — invited/active → scim_user_provisioned", () => {
  assertEquals(
    auditNameForTransition("invited"),
    IDENTITY_AUDIT_NAMES.scim_user_provisioned,
  );
  assertEquals(
    auditNameForTransition("active"),
    IDENTITY_AUDIT_NAMES.scim_user_provisioned,
  );
});

Deno.test("auditNameForTransition — suspended → scim_user_suspended", () => {
  assertEquals(
    auditNameForTransition("suspended"),
    IDENTITY_AUDIT_NAMES.scim_user_suspended,
  );
});

Deno.test("auditNameForTransition — deprovisioned → scim_user_deprovisioned", () => {
  assertEquals(
    auditNameForTransition("deprovisioned"),
    IDENTITY_AUDIT_NAMES.scim_user_deprovisioned,
  );
});
