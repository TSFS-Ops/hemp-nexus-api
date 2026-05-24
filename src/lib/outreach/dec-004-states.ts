/**
 * DEC-004 Phase 1 — Manual outreach ownership & state SSOT.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-004.
 *
 * Phase 1 scope (this module):
 *   1. Declare the sole approved manual-outreach owner (Izenzo admin /
 *      platform_admin) and the explicit non-owners (Vericro, Imperial
 *      Tech, payment providers).
 *   2. Declare the canonical outreach state names enumerated in the
 *      signed form and map each onto the implementation surface that
 *      currently expresses it (`engagement_status` enum + operational
 *      flags + SLA counters + suppressed/test markers). The mapping is
 *      descriptive — Phase 1 does NOT introduce new DB enum values.
 *   3. Declare the canonical DEC-004 audit action names.
 *
 * PHASE 1 EXPLICITLY DOES NOT:
 *   - introduce new engagement_status DB enum values
 *   - introduce a manual-owner reassignment surface (there is none —
 *     Izenzo admin is the sole owner; `OUTREACH_MANUAL_OWNER_REASSIGNED`
 *     is exported so the constant exists and is testable, but it is
 *     guaranteed NOT to be emitted at runtime, and the test suite pins
 *     that absence)
 *   - change which states block POI / WaD / execution / credit / payment
 *   - rename or retire any existing audit name
 */

// ── Ownership ─────────────────────────────────────────────────────────

/** Sole approved manual-outreach owner. */
export const DEC_004_MANUAL_OUTREACH_OWNER = "izenzo_platform_admin";

/**
 * Explicit non-owners. The signed form names these parties to make
 * clear they are NOT responsible for, and MUST NOT be assigned,
 * platform-originated manual outreach.
 */
export const DEC_004_FORBIDDEN_OUTREACH_OWNERS = Object.freeze([
  "vericro",
  "imperial_tech",
  "imperial",
  "paystack",
  "stripe",
  "payment_provider",
] as const);

/**
 * Manual-owner reassignment is NOT implemented. The constant below is
 * declared so the SSOT is complete, but the `reassignmentImplemented`
 * flag is false and the test suite asserts the action is never emitted
 * at runtime.
 */
export const DEC_004_REASSIGNMENT_IMPLEMENTED = false as const;

// ── Canonical outreach states ─────────────────────────────────────────

/**
 * Describes how a canonical signed-form state name is currently
 * expressed by the live implementation. Phase 1 does NOT add new DB
 * enum values; it maps the signed-form vocabulary onto the existing
 * fields.
 */
export interface Dec004StateMapping {
  /** Plain-English summary of when this state applies. */
  readonly description: string;
  /**
   * Set of `engagement_status` enum values that satisfy this state, or
   * `null` if the state is expressed entirely through operational
   * flags.
   */
  readonly engagementStatus: ReadonlyArray<string> | null;
  /**
   * Set of `operational_state` values (or null) — these are the
   * Batch-J operational hold states layered over `engagement_status`.
   */
  readonly operationalState: ReadonlyArray<string> | null;
  /**
   * Additional row-level predicates (column names) that, when truthy,
   * place a row into this state.
   */
  readonly rowFlags: ReadonlyArray<string>;
  /**
   * True iff this state requires a human (Izenzo admin) action before
   * the engagement can move forward. Phase 1 uses this to assert that
   * POI / WaD / execution / credit / payment are blocked until the
   * state is resolved.
   */
  readonly requiresHumanAction: true;
}

export const DEC_004_OUTREACH_STATES: Readonly<Record<string, Dec004StateMapping>> = Object.freeze({
  first_contact_review_required: {
    description:
      "Engagement is bound to a candidate identity that requires admin binding review before any first contact is attempted.",
    engagementStatus: ["pending"],
    operationalState: ["binding_review_required"],
    rowFlags: ["binding_candidates"],
    requiresHumanAction: true,
  },
  contact_details_required: {
    description:
      "Engagement has no usable counterparty email or no counterparty contact name; outreach is blocked until an admin adds contact details.",
    engagementStatus: ["pending"],
    operationalState: null,
    rowFlags: ["counterparty_email_missing", "contact_name_missing"],
    requiresHumanAction: true,
  },
  awaiting_outreach: {
    description:
      "Engagement is complete enough to contact but the admin has not yet dispatched the approved outreach.",
    engagementStatus: ["pending", "notification_sent"],
    operationalState: null,
    rowFlags: [],
    requiresHumanAction: true,
  },
  contacted_awaiting_response: {
    description:
      "Outreach has been sent and the platform is awaiting a counterparty response.",
    engagementStatus: ["contacted"],
    operationalState: null,
    rowFlags: [],
    requiresHumanAction: true,
  },
  reminder_review_required: {
    description:
      "SLA window has elapsed since outreach and the reminder cadence requires admin review before re-contacting.",
    engagementStatus: ["pending", "notification_sent", "contacted"],
    operationalState: null,
    rowFlags: ["sla_reminder_sent_at", "sla_reminder_count"],
    requiresHumanAction: true,
  },
  bounce_review_required: {
    description:
      "Outreach email bounced or was suppressed by the email provider; admin must reconcile before further contact.",
    engagementStatus: ["contacted"],
    operationalState: null,
    rowFlags: ["bounce_recorded_at", "email_suppressed_at"],
    requiresHumanAction: true,
  },
  no_response_review_required: {
    description:
      "Counterparty has not responded within the configured no-response window; admin must decide next action.",
    engagementStatus: ["contacted"],
    operationalState: null,
    rowFlags: ["no_response_flagged_at"],
    requiresHumanAction: true,
  },
  dispute_review_required: {
    description:
      "Named counterparty has disputed being engaged; admin must resolve before any further outreach.",
    engagementStatus: ["disputed_being_named"],
    operationalState: null,
    rowFlags: ["disputed_at"],
    requiresHumanAction: true,
  },
  late_acceptance_review_required: {
    description:
      "Counterparty accepted after the late-acceptance window; admin must record initiator reconfirmation or decline.",
    engagementStatus: ["accepted", "late_acceptance_pending_initiator_reconfirmation"],
    operationalState: null,
    rowFlags: ["late_acceptance_recorded_at", "late_acceptance_resolution"],
    requiresHumanAction: true,
  },
  suppressed_test_review_required: {
    description:
      "Engagement targets a suppressed or test-mode recipient; admin must confirm before any real-world outreach.",
    engagementStatus: ["pending", "notification_sent"],
    operationalState: null,
    rowFlags: ["is_demo", "suppressed_recipient"],
    requiresHumanAction: true,
  },
});

export const DEC_004_CANONICAL_STATE_NAMES = Object.freeze(
  Object.keys(DEC_004_OUTREACH_STATES) as ReadonlyArray<keyof typeof DEC_004_OUTREACH_STATES>,
);

// ── Canonical audit names ────────────────────────────────────────────

export const OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED =
  "outreach.manual_follow_up_assigned";

export const OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED =
  "outreach.manual_follow_up_action_recorded";

/**
 * Declared for SSOT completeness only. There is no manual-owner
 * reassignment surface (Izenzo admin is the sole owner). The test
 * suite pins that this string is NOT emitted at runtime in any edge
 * function.
 */
export const OUTREACH_MANUAL_OWNER_REASSIGNED =
  "outreach.manual_owner_reassigned";

export const OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP =
  "outreach.sla_scan_flagged_manual_follow_up";

export const DEC_004_OUTREACH_AUDIT_ACTIONS = Object.freeze([
  OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED,
  OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED,
  OUTREACH_MANUAL_OWNER_REASSIGNED,
  OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP,
] as const);

/**
 * Audit names that ARE wired to runtime emit sites under Phase 1.
 * `OUTREACH_MANUAL_OWNER_REASSIGNED` is intentionally absent.
 */
export const DEC_004_RUNTIME_EMITTED_AUDIT_ACTIONS = Object.freeze([
  OUTREACH_MANUAL_FOLLOW_UP_ASSIGNED,
  OUTREACH_MANUAL_FOLLOW_UP_ACTION_RECORDED,
  OUTREACH_SLA_SCAN_FLAGGED_MANUAL_FOLLOW_UP,
] as const);
