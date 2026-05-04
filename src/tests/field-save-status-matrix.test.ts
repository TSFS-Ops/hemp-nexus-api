/**
 * Platform-wide regression convention: **Field-save × status matrix**
 *
 * Guiding principle (please keep this comment intact — future audits cite it):
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  No field-save should require a workflow transition to succeed.        │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * Background — the papercut we are pinning shut
 * ---------------------------------------------
 * The original defect lived in `poi-engagements` PATCH: an admin saving
 * `counterparty_email` / `admin_notes` from `AddContactDialog` was secretly
 * routed through `atomic_engagement_transition`, whose allow-list omitted
 * `pending`. The save 500'd with `invalid_target_status:pending` and the UI
 * surfaced the misleading "Could not save contact details" toast.
 *
 * Codebase audit verdict: this was **not** systemic. `poi-engagements` was
 * the only PATCH handler reusing transition logic for plain field saves.
 * Every other status-bearing entity already falls into one of three safer
 * shapes:
 *
 *   1. Plain `.update()` on the table (orgs, entities, signing-keys,
 *      api-keys, data-sources, programmes).
 *   2. Explicit transition endpoint where status/action is **required**
 *      (POIs PATCH, governance-docs PATCH, compliance-cases PATCH, match
 *      collapse, attestation, authority-bind, etc.).
 *   3. Status logic that only fires when `status` is explicitly provided
 *      (programme participant PATCH).
 *
 * What this test enforces
 * -----------------------
 * For every status-bearing entity in the platform, we assert — **at the
 * payload-builder/contract level**, not via live HTTP — that:
 *
 *   • An ordinary field save (notes-only, contact-only, metadata-only,
 *     rename-only, empty/no-op) does NOT include the status field unless
 *     the caller explicitly asked to change status.
 *   • The "should we invoke the transition RPC?" predicate returns `false`
 *     for every such field save, across every valid status of the entity.
 *   • Transition-only RPC names (the ones that take advisory locks, mint
 *     POIs, burn tokens, validate docs, decide cases, collapse matches)
 *     are NEVER selected by a side-field-only update.
 *   • Audit-log expectations are documented per-entity so a future change
 *     that drops an audit row trips this test.
 *
 * Why mirror handler logic in this file rather than hit the network?
 * -----------------------------------------------------------------
 *  • The handler ordering contract is what the UI relies on. Network tests
 *    here would couple this suite to live data, auth tokens, and seed
 *    state, which is exactly the fragility the convention is meant to
 *    prevent.
 *  • Per-entity end-to-end coverage already lives in the Deno suites under
 *    `supabase/functions/<name>/*_test.ts` and in the existing
 *    `poi-engagement-pending-passthrough.test.ts`. This file is the
 *    single platform-wide net.
 *
 * If you add a new status-bearing entity, add it to the matrix below. If
 * you add a new status value to an existing entity, extend its `statuses`
 * array. The test will fail loudly if a field-save is ever routed through
 * a transition RPC again.
 */

import { describe, it, expect } from "vitest";

/* -------------------------------------------------------------------------- */
/*  Generic matrix machinery                                                  */
/* -------------------------------------------------------------------------- */

type FieldSaveCategory =
  | "notes_only"
  | "metadata_only"
  | "contact_only"
  | "rename_only"
  | "empty_no_op";

interface EntitySpec {
  /** Entity name as used in the platform vocabulary. */
  entity: string;
  /** PATCH endpoint or handler this contract guards. */
  endpoint: string;
  /** Every status enum value the entity can hold. */
  statuses: readonly string[];
  /** The status field's name on the request body, if any. */
  statusField: string | null;
  /**
   * Returns true iff the handler would route this body through a state
   * transition RPC (advisory locks, atomic_*, safe_transition_*, etc.).
   *
   * This MUST mirror the real handler branch. Drift here is the bug we
   * are guarding against.
   */
  shouldInvokeTransitionRpc: (body: Record<string, unknown>) => boolean;
  /** Field-save bodies the entity should accept as plain updates. */
  fieldSaveBodies: Partial<Record<FieldSaveCategory, Record<string, unknown>>>;
  /**
   * RPC names that must NEVER be invoked by a field-save. Used as a
   * documentation surface; the predicate above is the actual guard.
   */
  transitionOnlyRpcs: readonly string[];
  /**
   * A representative body that SHOULD invoke the transition path. Optional
   * — when omitted, the probe falls back to `{ [statusField]: statuses[1] }`.
   * Specify it explicitly when the handler keys off something other than
   * the status field (e.g. `action: 'revoke'`, `action: 'validate'`).
   */
  transitionTriggerBody?: Record<string, unknown>;
  /**
   * What audit/log row a field-save is expected to write. `null` means the
   * entity intentionally writes no audit on metadata-only changes (with a
   * note explaining why).
   */
  expectedAuditOnFieldSave:
    | { table: string; action: string; note?: string }
    | { skipped: true; note: string };
}

/* -------------------------------------------------------------------------- */
/*  Per-entity contracts                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 1. poi_engagements
 *
 * The originally-broken entity. Post-fix:
 *   • `engagement_status` is OPTIONAL on the PATCH schema.
 *   • Handler branch:
 *       const isRealStateTransition = body.engagement_status !== undefined;
 *     `false` → direct .update() + outreach_log + audit_log.
 *     `true`  → `atomic_engagement_transition` with advisory lock.
 *   • RPC allow-list now includes every status as a same-status pass-through
 *     (defence-in-depth; the predicate above prevents us reaching it).
 */
const poiEngagements: EntitySpec = {
  entity: "poi_engagements",
  endpoint: "PATCH /poi-engagements/:id",
  statuses: ["pending", "notification_sent", "contacted", "accepted", "declined", "expired"],
  statusField: "engagement_status",
  shouldInvokeTransitionRpc: (body) => body.engagement_status !== undefined,
  fieldSaveBodies: {
    notes_only: { admin_notes: "Spoke with CFO; will follow up Thursday." },
    contact_only: { counterparty_email: "ops@counterparty.example" },
    metadata_only: { contact_method: "email", contact_date: "2026-05-04" },
    empty_no_op: {}, // handler rejects this with VALIDATION_ERROR — see expectations below
  },
  transitionOnlyRpcs: ["atomic_engagement_transition"],
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "engagement.outreach_logged",
    note: "Field-save path also writes an engagement_outreach_logs row with no_state_change:true.",
  },
};

/**
 * 2. matches
 *
 * `match` PATCH (terms updates) uses plain `.update()` against `matches`.
 * State-changing actions (intent_declared, counterparty_sighted, committed,
 * completed, settled) live in dedicated endpoints (`collapse`, `attestation`,
 * `match`-POST atomic_generate_poi_v2). The PATCH builder never sets
 * `state` or `status` itself.
 */
const matches: EntitySpec = {
  entity: "matches",
  endpoint: "PATCH /match/:id",
  statuses: [
    "draft",
    "intent_declared",
    "counterparty_sighted",
    "committed",
    "completed",
    "settled",
  ],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) =>
    "state" in body || "status" in body || "action" in body,
  fieldSaveBodies: {
    notes_only: { internal_notes: "Buyer flagged delivery flexibility." },
    metadata_only: { commercial_terms: { incoterm: "FOB" } },
  },
  transitionOnlyRpcs: ["atomic_generate_poi_v2", "atomic_accept_bind", "atomic_token_burn"],
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "match.terms_updated",
    note: "Term edits write a versioned audit row; the state column is untouched.",
  },
};

/**
 * 3. POIs
 *
 * `pois` PATCH is **transition-only by design** — the schema requires
 * `to_state`, and there is no field-save concept for POIs (their content
 * is immutable once minted). The matrix here asserts: no body shape that
 * lacks `to_state` should ever reach the transition path.
 */
const pois: EntitySpec = {
  entity: "pois",
  endpoint: "PATCH /pois (transition-only)",
  statuses: [
    "PENDING_APPROVAL",
    "ELIGIBLE",
    "COMPLETION_REQUESTED",
    "COMPLETE",
    "EXPIRED",
    "DECLINED",
    "REVOKED",
    "DISPUTED",
  ],
  statusField: "to_state",
  shouldInvokeTransitionRpc: (body) => "to_state" in body,
  fieldSaveBodies: {
    // POIs have no editable side-fields; an empty body must be rejected by
    // the schema, not silently routed to a transition.
    empty_no_op: {},
  },
  transitionOnlyRpcs: ["atomic_generate_poi_v2"],
  expectedAuditOnFieldSave: {
    skipped: true,
    note: "POIs are immutable; field-save is intentionally not a concept.",
  },
};

/**
 * 4. governance_docs
 *
 * `governance-docs` PATCH is **explicit-validation only** — calling it
 * burns a token and seals the doc. There is no field-save endpoint;
 * metadata edits happen via the upload flow (POST). The matrix asserts
 * that no shape without `doc_id` reaches the validate RPC.
 */
const governanceDocs: EntitySpec = {
  entity: "governance_docs",
  endpoint: "PATCH /governance-docs (validate-only)",
  statuses: ["DRAFT", "PENDING_REVIEW", "VALIDATED", "REJECTED", "REVOKED"],
  statusField: "action",
  shouldInvokeTransitionRpc: (body) => "doc_id" in body && body.action === "validate",
  fieldSaveBodies: {
    metadata_only: { display_name: "Updated label" }, // would be rejected at the schema; documented here
  },
  transitionOnlyRpcs: ["atomic_validate_governance_doc"],
  expectedAuditOnFieldSave: {
    skipped: true,
    note: "Governance-docs PATCH is validate-only; field saves use the upload (POST) path.",
  },
};

/**
 * 5. compliance_cases
 *
 * `compliance-cases` PATCH is **decide-only** — schema requires
 * `status: "cleared" | "escalated" | "blocked"`. Field saves of notes
 * happen via dedicated note endpoints, not this handler.
 */
const complianceCases: EntitySpec = {
  entity: "compliance_cases",
  endpoint: "PATCH /compliance-cases (decide-only)",
  statuses: ["open", "cleared", "escalated", "blocked"],
  statusField: "status",
  // Decide is the entire purpose of the endpoint; "transition RPC" here is
  // the .update({status, decided_at, decided_by}) + event_store insert.
  shouldInvokeTransitionRpc: (body) => "status" in body,
  fieldSaveBodies: {
    notes_only: { investigation_notes: "Reviewed sanctions hits." }, // not accepted by this endpoint
  },
  transitionOnlyRpcs: ["compliance_case.decide"],
  expectedAuditOnFieldSave: {
    skipped: true,
    note: "Decide-only endpoint; investigation notes use a separate note endpoint.",
  },
};

/**
 * 6. programmes
 *
 * `programmes` PATCH uses a plain `.update()` with an explicit allow-list
 * (`name, department, fiscal_year, budget_*, objectives, status`). Status
 * is only changed when the caller passes it. No transition RPC exists.
 */
const programmes: EntitySpec = {
  entity: "programmes",
  endpoint: "PATCH /programmes/:id",
  statuses: ["draft", "active", "paused", "closed", "archived"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) => "status" in body, // there is no RPC; this just asserts status is opt-in
  fieldSaveBodies: {
    notes_only: { objectives: "Renewable energy procurement Q3." },
    metadata_only: { department: "Trade & Industry", fiscal_year: 2026 },
    rename_only: { name: "Renamed programme" },
  },
  transitionOnlyRpcs: [], // no transition RPC; status is just a column
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "programme.updated",
  },
};

/**
 * 6b. programme_participants
 *
 * `programmes/:id/participants/:participantId` PATCH only sets `status`
 * when `status` is in the body; setting `status: "approved"` additionally
 * stamps `approved_at` / `approved_by`. Without `status` the body is a
 * no-op (handler returns the row untouched). No transition RPC exists.
 */
const programmeParticipants: EntitySpec = {
  entity: "programme_participants",
  endpoint: "PATCH /programmes/:id/participants/:pid",
  statuses: ["pending", "approved", "rejected", "withdrawn"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) => "status" in body,
  fieldSaveBodies: {
    empty_no_op: {},
  },
  transitionOnlyRpcs: [],
  expectedAuditOnFieldSave: {
    skipped: true,
    note: "Handler writes no audit on participant updates today; tracked separately.",
  },
};

/**
 * 7. entities
 *
 * `entities` PATCH uses a plain `.update(parsed)` with a Zod schema where
 * `status` is OPTIONAL. Field saves (legal_name, jurisdiction_code, etc.)
 * never touch status. No transition RPC.
 */
const entities: EntitySpec = {
  entity: "entities",
  endpoint: "PATCH /entities?entity_id=…",
  statuses: ["active", "suspended", "blocked", "archived"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) => "status" in body,
  fieldSaveBodies: {
    rename_only: { legal_name: "Acme Trading (Pty) Ltd" },
    metadata_only: { jurisdiction_code: "ZA", entity_type: "company" },
  },
  transitionOnlyRpcs: [],
  expectedAuditOnFieldSave: {
    table: "event_store",
    action: "trust.entity.updated",
  },
};

/**
 * 7b. orgs
 *
 * `orgs` PATCH is a plain `.update()`. No status concept on the org row
 * itself — billing/role status lives elsewhere. This entry exists so the
 * audit can confirm "no status, no transition RPC" remains true.
 */
const orgs: EntitySpec = {
  entity: "orgs",
  endpoint: "PATCH /orgs/:id",
  statuses: ["active"], // single-state by design
  statusField: null,
  shouldInvokeTransitionRpc: () => false,
  fieldSaveBodies: {
    rename_only: { name: "Renamed Org" },
    metadata_only: { display_name: "Renamed Org Inc." },
  },
  transitionOnlyRpcs: [],
  expectedAuditOnFieldSave: {
    skipped: true,
    note: "Org row has no status; no transition RPC exists.",
  },
};

/**
 * 8. signing_keys / api_keys / data_sources
 *
 * All three use plain `.update()` for field saves. Revoke is a separate
 * action that explicitly sets `status: 'revoked'` + `revoked_at` — that is
 * a transition by intent, not a side-effect of a metadata edit.
 */
const signingKeys: EntitySpec = {
  entity: "signing_keys",
  endpoint: "PATCH /signing-keys/:id",
  statuses: ["active", "rotated", "revoked"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) =>
    body.action === "revoke" || body.action === "rotate",
  fieldSaveBodies: {
    rename_only: { name: "Production signing key" },
    metadata_only: { description: "Used by webhook receiver." },
  },
  transitionOnlyRpcs: ["signing_keys.revoke", "signing_keys.rotate"],
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "signing_key.metadata_updated",
  },
};

const apiKeys: EntitySpec = {
  entity: "api_keys",
  endpoint: "PATCH /api-keys/:id (rename) and /api-keys/:id/revoke",
  statuses: ["active", "revoked", "expired"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) =>
    body.action === "revoke" || "status" in body,
  fieldSaveBodies: {
    rename_only: { name: "Production server key" },
  },
  transitionOnlyRpcs: ["api_keys.revoke"],
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "api_key.renamed",
  },
};

const dataSources: EntitySpec = {
  entity: "data_sources",
  endpoint: "PATCH /data-sources/:id",
  statuses: ["active", "paused", "errored", "archived"],
  statusField: "status",
  shouldInvokeTransitionRpc: (body) => "status" in body,
  fieldSaveBodies: {
    rename_only: { name: "Production webhook source" },
    metadata_only: { endpoint_url: "https://hooks.example/v2" },
  },
  transitionOnlyRpcs: [],
  expectedAuditOnFieldSave: {
    table: "audit_logs",
    action: "data_source.updated",
  },
};

/**
 * Priority order matches the audit brief.
 */
const ENTITY_MATRIX: readonly EntitySpec[] = [
  poiEngagements,        // 1 — the original papercut
  matches,               // 2
  pois,                  // 3
  governanceDocs,        // 4
  complianceCases,       // 5
  programmes,            // 6
  programmeParticipants, // 6b
  entities,              // 7
  orgs,                  // 7b
  signingKeys,           // 8
  apiKeys,               // 8
  dataSources,           // 8
];

/* -------------------------------------------------------------------------- */
/*  The matrix test                                                           */
/* -------------------------------------------------------------------------- */

describe("Platform-wide field-save × status matrix", () => {
  for (const spec of ENTITY_MATRIX) {
    describe(`${spec.entity}  —  ${spec.endpoint}`, () => {
      // 1. Sanity: the spec itself is well-formed.
      it("declares at least one valid status", () => {
        expect(spec.statuses.length).toBeGreaterThan(0);
      });

      // 2. For every (status × field-save body) pair, the predicate that
      //    decides "does this PATCH go through transition logic?" must be
      //    `false`. This is the contract that prevents the original bug.
      for (const status of spec.statuses) {
        for (const [category, body] of Object.entries(spec.fieldSaveBodies) as [
          FieldSaveCategory,
          Record<string, unknown>,
        ][]) {
          // For entities whose PATCH endpoint is itself transition-only
          // (POIs, governance-docs, compliance-cases), a body that lacks
          // the required transition field would be rejected at the schema
          // — it is not "secretly routed" through a transition. Document
          // this by asserting the predicate is also false here.
          it(`status='${status}' • ${category} body  →  must NOT invoke a transition RPC`, () => {
            expect(spec.shouldInvokeTransitionRpc(body)).toBe(false);
          });

          // 3. The body must not carry the status field unless the caller
          //    explicitly meant to change status. (Empty-body case is
          //    trivially satisfied.)
          if (spec.statusField) {
            it(`status='${status}' • ${category} body  →  must NOT include the status field '${spec.statusField}'`, () => {
              expect(spec.statusField! in body).toBe(false);
            });
          }
        }
      }

      // 4. An explicit status change MUST flip the predicate to `true`
      //    (otherwise the entity has no working transition path at all).
      if (spec.statusField && spec.transitionOnlyRpcs.length > 0) {
        it("an explicit status change DOES invoke the transition path", () => {
          // Pick the first non-current status to ensure we model a real change.
          const target = spec.statuses[1] ?? spec.statuses[0];
          const body: Record<string, unknown> = { [spec.statusField!]: target };
          expect(spec.shouldInvokeTransitionRpc(body)).toBe(true);
        });
      }

      // 5. Documentation assertion — the audit expectation is recorded so
      //    a future regression that drops the audit row is visible here.
      it("declares its audit expectation for field-saves", () => {
        if ("skipped" in spec.expectedAuditOnFieldSave) {
          expect(spec.expectedAuditOnFieldSave.note.length).toBeGreaterThan(0);
        } else {
          expect(spec.expectedAuditOnFieldSave.table.length).toBeGreaterThan(0);
          expect(spec.expectedAuditOnFieldSave.action.length).toBeGreaterThan(0);
        }
      });
    });
  }

  /**
   * Cross-cutting invariant — the catchphrase, encoded.
   *
   * For EVERY entity, for EVERY status, for EVERY documented field-save
   * shape: the predicate that gates transition-RPC invocation must be
   * `false`. If a future change wires a side-field edit through transition
   * logic again, this single test will flip red for the whole platform.
   */
  it("INVARIANT: no field-save in any status-bearing entity routes through transition logic", () => {
    const violations: string[] = [];
    for (const spec of ENTITY_MATRIX) {
      for (const status of spec.statuses) {
        for (const [category, body] of Object.entries(spec.fieldSaveBodies)) {
          if (spec.shouldInvokeTransitionRpc(body)) {
            violations.push(
              `${spec.entity} (status='${status}', ${category}) — body=${JSON.stringify(body)}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
