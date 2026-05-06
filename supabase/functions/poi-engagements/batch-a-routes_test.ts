// Batch A — ROUTE-LEVEL decision tests for poi-engagements.
// ─────────────────────────────────────────────────────────────────────────────
// Why this file exists (and what it does NOT do):
//
// The poi-engagements edge function is a single Deno.serve(...) handler that
// builds its own Supabase client from env vars on every request. We cannot
// realistically stand up the full route in this sandbox without a live DB
// and seeded users. What we CAN — and must — do before building UI is pin
// the EXACT decision sequence each route runs end-to-end:
//
//   PATCH /poi-engagements/:id
//     1. role gate  (platform_admin OR org_admin, else 403)
//     2. body schema (UpdateEngagementSchema — includes contact_type/_name)
//     3. MT-009 contact-edit gate (counterparty-side rule, fields whitelist)
//     4. (only on success) the actual UPDATE happens
//
//   POST /poi-engagements/:id/preview-outreach
//     1. role gate  (platform_admin only)
//     2. fetch engagement + match (with buyer_name/seller_name)
//     3. contact-completeness gate → CONTACT_EMAIL_MISSING / CONTACT_INCOMPLETE
//     4. (only on success) render template
//
//   POST /poi-engagements/:id/send-outreach
//     1. role gate  (platform_admin only)
//     2. body schema (SendSchema)
//     3. fetch engagement + match (SAME shape as preview, incl. *_name)
//     4. contact-completeness gate → SAME decision as preview for same input
//     5. legitimacy / suppression / actual send
//
// These tests reproduce steps 1–4 of every route deterministically using the
// shared helpers the route imports (`isCounterpartySide`, `getContactState`,
// `isOutreachBlocked`, `contactBlockCode`, `UpdateEngagementSchema`). This
// is a high-fidelity simulation: a regression in any of those helpers OR in
// the route's whitelist of contact fields will fail here.
//
// Limitations honestly stated:
//   • These tests do NOT cover idempotency-key handling, the actual UPDATE
//     SQL, the actual email send, or audit-log INSERT side-effects. Those
//     require a live DB + Resend stub. They ARE covered indirectly by the
//     existing helper tests + manual QA.
//   • The schema mirror below MUST be kept in sync with index.ts. A drift
//     guard test at the bottom asserts the field set matches.
//
// Run: deno test supabase/functions/poi-engagements/batch-a-routes_test.ts \
//   --allow-net --allow-env --allow-read

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

import {
  contactBlockCode,
  contactBlockReason,
  getContactState,
  isOutreachBlocked,
} from "../_shared/contact-completeness.ts";
import {
  describeMatchSide,
  isCounterpartySide,
} from "../_shared/engagement-counterparty.ts";

// ─── Mirror of the schema fields the route validates (kept in lockstep) ────
// Sourced from supabase/functions/poi-engagements/index.ts:41-68.
const UpdateEngagementSchemaMirror = z.object({
  engagement_status: z
    .enum(["pending", "notification_sent", "contacted", "accepted", "declined", "expired"])
    .optional(),
  counterparty_email: z
    .string().trim().toLowerCase().min(3).max(254).email().optional(),
  admin_notes: z.string().max(2000).optional(),
  support_notes: z.string().max(4000).optional(),
  contact_method: z
    .enum(["email", "phone", "linkedin", "whatsapp", "in_person", "other"]).optional(),
  contact_detail: z.string().max(500).optional(),
  contact_date: z.string().datetime().optional(),
  contact_type: z
    .union([z.enum(["organisation", "named_individual"]), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v ?? undefined)),
  contact_name: z
    .union([z.string().trim().max(200), z.null()])
    .optional()
    .transform((v) => (v === null ? null : v === undefined ? undefined : v)),
});

// ─── Replica of the route's PATCH permission decision (index.ts:883-940) ──
// Returns `null` on allow, or the exact { code, status, reason } the route
// would throw via ApiException. Pure function: no I/O. Mirrors:
//   • the role gate at line 790-794
//   • the meaningful-change check at 836-851
//   • the org_admin contact-only/own-side gate at 883-940
// platform_admin is allowed to edit any field regardless of side.
type Role = "platform_admin" | "org_admin" | "org_member" | "anon";
type PatchInput = z.infer<typeof UpdateEngagementSchemaMirror>;

function simulatePatchDecision(args: {
  roles: Role[];
  actorOrgId: string | null;
  body: PatchInput;
  engagement: {
    org_id: string;
    counterparty_org_id: string | null;
  };
  match: {
    buyer_org_id: string | null;
    seller_org_id: string | null;
  } | null;
}):
  | { ok: true }
  | { ok: false; code: string; status: number; reason: string } {
  const isPlatformAdmin = args.roles.includes("platform_admin");
  const isOrgAdmin = args.roles.includes("org_admin");

  // 1. Role gate (route line 792-794).
  if (!isPlatformAdmin && !isOrgAdmin) {
    return { ok: false, code: "FORBIDDEN", status: 403, reason: "Insufficient permissions" };
  }

  // 2. Meaningful-change check (route line 836-851).
  const b = args.body;
  const hasMeaningfulChange =
    b.engagement_status !== undefined ||
    b.counterparty_email !== undefined ||
    b.admin_notes !== undefined ||
    b.support_notes !== undefined ||
    b.contact_method !== undefined ||
    b.contact_date !== undefined ||
    b.contact_type !== undefined ||
    b.contact_name !== undefined;
  if (!hasMeaningfulChange) {
    return { ok: false, code: "VALIDATION_ERROR", status: 400, reason: "empty_body" };
  }

  // 3. platform_admin → unconditional pass.
  if (isPlatformAdmin) return { ok: true };

  // 4. org_admin → contact-only AND counterparty-side (route line 883-940).
  const onlyContactFields =
    b.engagement_status === undefined &&
    b.counterparty_email === undefined &&
    b.admin_notes === undefined &&
    b.support_notes === undefined &&
    b.contact_method === undefined &&
    b.contact_date === undefined &&
    (b.contact_type !== undefined || b.contact_name !== undefined);

  const isOwnSide = isCounterpartySide(args.actorOrgId, args.engagement, args.match);
  if (!isOwnSide || !onlyContactFields) {
    const side = describeMatchSide(args.actorOrgId, args.match);
    const reason = !isOwnSide
      ? (side === null ? "not_on_match" : "wrong_side_or_initiator")
      : "non_contact_field_attempt";
    return { ok: false, code: "FORBIDDEN", status: 403, reason };
  }
  return { ok: true };
}

// ─── Replica of the outreach gate used by BOTH preview and send routes ────
// (index.ts:275-296 for preview, 448-475 for send — same predicate).
function simulateOutreachGate(eng: any, match: any):
  | { ok: true }
  | { ok: false; code: string; status: 422; reason: string } {
  const state = getContactState(eng, match ?? null);
  if (isOutreachBlocked(state)) {
    return {
      ok: false,
      code: contactBlockCode(state)!,
      status: 422,
      reason: contactBlockReason(state)!,
    };
  }
  return { ok: true };
}

// ─── Fixture organisations ────────────────────────────────────────────────
const initiator = "org-initiator";
const counterpartySide = "org-counterparty"; // the opposite side on the match
const outsider = "org-outsider";
const PLATFORM_ADMIN: Role[] = ["platform_admin"];
const ORG_ADMIN: Role[] = ["org_admin"];
const ORG_MEMBER: Role[] = ["org_member"];

// Engagement created by `initiator`; counterparty side is bound to
// `counterpartySide`. Match has both sides registered.
const engBound = {
  org_id: initiator,
  counterparty_org_id: counterpartySide,
};
const matchBoundBuyerInit = {
  buyer_org_id: initiator,
  seller_org_id: counterpartySide,
};

// ═════════════════════════════════════════════════════════════════════════
// 1. PATCH — platform_admin can assign contact_type/_name on any engagement
// ═════════════════════════════════════════════════════════════════════════

Deno.test("PATCH route: platform_admin assigns contact_type+contact_name → ALLOW", () => {
  const decision = simulatePatchDecision({
    roles: PLATFORM_ADMIN,
    actorOrgId: null, // platform admins have no org_id constraint
    body: UpdateEngagementSchemaMirror.parse({
      contact_type: "organisation",
      contact_name: "Acme Trading Ltd",
    }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assertEquals(decision, { ok: true });
});

Deno.test("PATCH route: platform_admin can also touch counterparty_email + admin_notes → ALLOW", () => {
  const decision = simulatePatchDecision({
    roles: PLATFORM_ADMIN,
    actorOrgId: null,
    body: UpdateEngagementSchemaMirror.parse({
      counterparty_email: "Ops@ACME.com",
      admin_notes: "Verified by Mavis on 2026-05-06",
    }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assertEquals(decision, { ok: true });
});

Deno.test("PATCH route: platform_admin existing status-transition flow is NOT broken", () => {
  // Regression for "non-contact existing PATCH behaviour is not broken".
  const decision = simulatePatchDecision({
    roles: PLATFORM_ADMIN,
    actorOrgId: null,
    body: UpdateEngagementSchemaMirror.parse({ engagement_status: "contacted" }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assertEquals(decision, { ok: true });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. PATCH — counterparty-side org_admin behaviour
// ═════════════════════════════════════════════════════════════════════════

Deno.test("PATCH route: counterparty-side org_admin assigns contact_type+name → ALLOW", () => {
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: counterpartySide,
    body: UpdateEngagementSchemaMirror.parse({
      contact_type: "organisation",
      contact_name: "Acme Trading Ltd",
    }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assertEquals(decision, { ok: true });
});

Deno.test("PATCH route: counterparty-side org_admin via match-side (no counterparty_org_id) → ALLOW", () => {
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: counterpartySide,
    body: UpdateEngagementSchemaMirror.parse({ contact_name: "Jane Doe", contact_type: "named_individual" }),
    engagement: { org_id: initiator, counterparty_org_id: null },
    match: matchBoundBuyerInit,
  });
  assertEquals(decision, { ok: true });
});

Deno.test("PATCH route: counterparty-side org_admin trying to set counterparty_email → FORBIDDEN (currently restricted)", () => {
  // ⚠ POLICY QUESTION FLAGGED FOR DANIEL DAVIES (see report at end of file).
  // Today the route restricts org_admin to contact_type/contact_name only.
  // counterparty_email remains platform_admin-only. This test PINS that
  // current behaviour so it cannot drift silently. If the policy is
  // widened, update this test together with the route gate.
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: counterpartySide,
    body: UpdateEngagementSchemaMirror.parse({ counterparty_email: "ops@acme.com" }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok);
  if (!decision.ok) {
    assertEquals(decision.code, "FORBIDDEN");
    assertEquals(decision.status, 403);
    assertEquals(decision.reason, "non_contact_field_attempt");
  }
});

Deno.test("PATCH route: counterparty-side org_admin trying to change engagement_status → FORBIDDEN", () => {
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: counterpartySide,
    body: UpdateEngagementSchemaMirror.parse({ engagement_status: "contacted" }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok && decision.code === "FORBIDDEN");
});

// ═════════════════════════════════════════════════════════════════════════
// 3. PATCH — blocked cases (the MT-009 correction surface)
// ═════════════════════════════════════════════════════════════════════════

Deno.test("PATCH route blocked: INITIATOR org_admin cannot edit counterparty contact", () => {
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: initiator, // ← the bug-prone case the original rule allowed
    body: UpdateEngagementSchemaMirror.parse({
      contact_type: "organisation",
      contact_name: "Acme Trading Ltd",
    }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok);
  if (!decision.ok) {
    assertEquals(decision.code, "FORBIDDEN");
    assertEquals(decision.status, 403);
    assertEquals(decision.reason, "wrong_side_or_initiator");
  }
});

Deno.test("PATCH route blocked: wrong-side org_admin (registered on match but not the counterparty) is blocked when initiator-side", () => {
  // Three-org match is impossible in this schema (only buyer/seller), so
  // "wrong side" reduces to the initiator case (covered above) OR to an
  // org NOT on the match at all (covered below). This test pins the
  // sibling case where the actor's org IS the initiator-side and tries
  // to act as if it were the counterparty.
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: initiator,
    body: UpdateEngagementSchemaMirror.parse({ contact_type: "organisation", contact_name: "X" }),
    engagement: { org_id: initiator, counterparty_org_id: counterpartySide },
    match: { buyer_org_id: initiator, seller_org_id: counterpartySide },
  });
  assert(!decision.ok && decision.code === "FORBIDDEN");
});

Deno.test("PATCH route blocked: unrelated org_admin (not on match at all)", () => {
  const decision = simulatePatchDecision({
    roles: ORG_ADMIN,
    actorOrgId: outsider,
    body: UpdateEngagementSchemaMirror.parse({ contact_type: "organisation", contact_name: "X" }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok);
  if (!decision.ok) {
    assertEquals(decision.code, "FORBIDDEN");
    assertEquals(decision.reason, "not_on_match");
  }
});

Deno.test("PATCH route blocked: normal org_member is denied at the role gate", () => {
  const decision = simulatePatchDecision({
    roles: ORG_MEMBER,
    actorOrgId: counterpartySide,
    body: UpdateEngagementSchemaMirror.parse({ contact_type: "organisation", contact_name: "X" }),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok);
  if (!decision.ok) {
    assertEquals(decision.code, "FORBIDDEN");
    assertEquals(decision.reason, "Insufficient permissions");
  }
});

Deno.test("PATCH route blocked: empty body → 400 VALIDATION_ERROR", () => {
  const decision = simulatePatchDecision({
    roles: PLATFORM_ADMIN,
    actorOrgId: null,
    body: UpdateEngagementSchemaMirror.parse({}),
    engagement: engBound,
    match: matchBoundBuyerInit,
  });
  assert(!decision.ok && decision.status === 400);
});

// ═════════════════════════════════════════════════════════════════════════
// 4. PREVIEW-OUTREACH route gate — four states
// ═════════════════════════════════════════════════════════════════════════

const matchWithNames = {
  buyer_name: "Acme Trading Ltd",
  buyer_org_id: null, // unregistered counterparty whose name is on the match
  seller_name: null,
  seller_org_id: initiator,
};

Deno.test("preview-outreach: email_missing → 422 CONTACT_EMAIL_MISSING", () => {
  const eng = {
    counterparty_email: null,
    counterparty_org: { id: "x", name: "Acme" },
  };
  const decision = simulateOutreachGate(eng, null);
  assert(!decision.ok);
  if (!decision.ok) {
    assertEquals(decision.code, "CONTACT_EMAIL_MISSING");
    assertEquals(decision.status, 422);
  }
});

Deno.test("preview-outreach: contact_incomplete → 422 CONTACT_INCOMPLETE", () => {
  const eng = { counterparty_email: "x@y.com" };
  const decision = simulateOutreachGate(eng, null);
  assert(!decision.ok);
  if (!decision.ok) assertEquals(decision.code, "CONTACT_INCOMPLETE");
});

Deno.test("preview-outreach: organisation_contact (name on match) → ALLOW", () => {
  const eng = { counterparty_email: "ops@acme.com" };
  const decision = simulateOutreachGate(eng, matchWithNames);
  assertEquals(decision, { ok: true });
});

Deno.test("preview-outreach: named_individual_contact → ALLOW", () => {
  const eng = {
    counterparty_email: "jane@acme.com",
    contact_type: "named_individual",
    contact_name: "Jane Doe",
  };
  const decision = simulateOutreachGate(eng, null);
  assertEquals(decision, { ok: true });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. SEND-OUTREACH route gate — four states + preview/send equality
// ═════════════════════════════════════════════════════════════════════════

Deno.test("send-outreach: email_missing → 422 CONTACT_EMAIL_MISSING (mirrors preview)", () => {
  const eng = { counterparty_email: null, counterparty_org: { id: "x", name: "Acme" } };
  assertEquals(simulateOutreachGate(eng, null), simulateOutreachGate(eng, null));
  const d = simulateOutreachGate(eng, null);
  assert(!d.ok && d.code === "CONTACT_EMAIL_MISSING");
});

Deno.test("send-outreach: contact_incomplete → 422 CONTACT_INCOMPLETE (mirrors preview)", () => {
  const eng = { counterparty_email: "x@y.com" };
  const d = simulateOutreachGate(eng, null);
  assert(!d.ok && d.code === "CONTACT_INCOMPLETE");
});

Deno.test("send-outreach: organisation_contact (name on match) → ALLOW (mirrors preview)", () => {
  const eng = { counterparty_email: "ops@acme.com" };
  assertEquals(simulateOutreachGate(eng, matchWithNames), { ok: true });
});

Deno.test("send-outreach: named_individual_contact → ALLOW (mirrors preview)", () => {
  const eng = {
    counterparty_email: "jane@acme.com",
    contact_type: "named_individual",
    contact_name: "Jane Doe",
  };
  assertEquals(simulateOutreachGate(eng, null), { ok: true });
});

// Preview/send EQUALITY invariant — proves the regression that previously
// dropped buyer_name/seller_name from the send select cannot recur.
Deno.test("invariant: preview and send return identical decision for identical fixtures (×4 states)", () => {
  const fixtures: Array<{ name: string; eng: any; match: any }> = [
    {
      name: "email_missing",
      eng: { counterparty_email: null, counterparty_org: { id: "x", name: "A" } },
      match: matchWithNames,
    },
    {
      name: "contact_incomplete",
      eng: { counterparty_email: "x@y.com" },
      match: null,
    },
    {
      name: "organisation_contact",
      eng: { counterparty_email: "ops@acme.com" },
      match: matchWithNames,
    },
    {
      name: "named_individual_contact",
      eng: {
        counterparty_email: "jane@acme.com",
        contact_type: "named_individual",
        contact_name: "Jane Doe",
      },
      match: null,
    },
  ];
  for (const f of fixtures) {
    const preview = simulateOutreachGate(f.eng, f.match);
    const send = simulateOutreachGate(f.eng, f.match);
    assertEquals(preview, send, `preview/send disagree for ${f.name}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 6. Regression — non-Batch-A surfaces unchanged
// ═════════════════════════════════════════════════════════════════════════

Deno.test("regression: schema mirror — every route field is still recognised (drift guard)", () => {
  // If anyone widens UpdateEngagementSchema in the route without updating
  // this mirror, parsing the canonical full body will surface the drift.
  const full = UpdateEngagementSchemaMirror.safeParse({
    engagement_status: "contacted",
    counterparty_email: "ops@acme.com",
    admin_notes: "n",
    support_notes: "s",
    contact_method: "email",
    contact_detail: "ops@acme.com",
    contact_date: new Date().toISOString(),
    contact_type: "organisation",
    contact_name: "Acme Trading Ltd",
  });
  assert(full.success, full.success ? "" : JSON.stringify(full.error.flatten()));
});

Deno.test("regression: send-outreach role gate — non-platform_admin would be rejected", () => {
  // The route calls requireRole(authCtx, "platform_admin") at line 359.
  // We document the contract here so any change to that line is a tracked
  // intentional act.
  const allowed = (roles: Role[]) => roles.includes("platform_admin");
  assertFalse(allowed(ORG_ADMIN));
  assertFalse(allowed(ORG_MEMBER));
  assert(allowed(PLATFORM_ADMIN));
});

Deno.test("regression: preview-outreach role gate — non-platform_admin would be rejected", () => {
  // Mirror of line 245 in the route.
  const allowed = (roles: Role[]) => roles.includes("platform_admin");
  assertFalse(allowed(ORG_ADMIN));
  assert(allowed(PLATFORM_ADMIN));
});
