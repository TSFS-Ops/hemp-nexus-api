/**
 * DEC-001 Phase 1 — Off-platform counterparty contact audit SSOT.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-001.
 *
 * Phase 1 scope: declare the canonical audit action names that describe
 * the lifecycle of an off-platform outreach decision. The signed form
 * names three events:
 *
 *   1. `pending_engagement.off_platform_outreach_evaluated` — emitted
 *      whenever an admin requests preview or send and the platform has
 *      walked the full gate-set (identity completeness, supersession,
 *      binding review, dispute, MT-008/MT-009 progression, compliance /
 *      legal hold). It records THAT the decision was made, regardless
 *      of outcome.
 *
 *   2. `pending_engagement.off_platform_outreach_sent` — emitted only
 *      after the approved cautious-wording email has been atomically
 *      queued and the engagement state has advanced to `contacted`
 *      (i.e. `engagement.outreach_email_queued` has just succeeded).
 *      It pairs with the operational queue audit and is intentionally
 *      additive — it does NOT replace any existing audit.
 *
 *   3. `pending_engagement.off_platform_outreach_blocked` — emitted
 *      alongside every concrete block branch (missing email, missing
 *      name, binding review required, disputed-being-named, expired,
 *      cancelled, superseded, compliance / legal hold, unsafe wording,
 *      MT-008/MT-009 progression refusal). It records THAT outreach
 *      was refused and carries a `blocked_reason` discriminator.
 *
 * The canonical names exist so HQ → Audit can answer "show me every
 * off-platform outreach decision" with a single action filter. They are
 * dual-written alongside the existing per-reason audit rows (which are
 * never removed — Batch H / CP-006 / CP-003 / DEC-005 / DEC-006 rows
 * remain as the operational source of truth for their respective
 * dashboards).
 *
 * PHASE 1 EXPLICITLY DOES NOT:
 *   - change outreach business rules
 *   - change which records are blocked / allowed
 *   - mint POI, burn credit, trigger WaD, or create payment events
 *   - introduce new outreach surfaces
 *   - reassign manual ownership (see dec-004-states.ts)
 */

export const OFF_PLATFORM_OUTREACH_EVALUATED =
  "pending_engagement.off_platform_outreach_evaluated";

export const OFF_PLATFORM_OUTREACH_SENT =
  "pending_engagement.off_platform_outreach_sent";

export const OFF_PLATFORM_OUTREACH_BLOCKED =
  "pending_engagement.off_platform_outreach_blocked";

/**
 * Frozen tuple of every canonical DEC-001 action name. The prebuild
 * guard (`scripts/check-dec-001-004-outreach-governance.mjs`) asserts
 * this exact list is present in the edge function `supabase/functions/
 * poi-engagements/index.ts`.
 */
export const DEC_001_OUTREACH_AUDIT_ACTIONS = Object.freeze([
  OFF_PLATFORM_OUTREACH_EVALUATED,
  OFF_PLATFORM_OUTREACH_SENT,
  OFF_PLATFORM_OUTREACH_BLOCKED,
] as const);

/**
 * Canonical `blocked_reason` discriminators. The edge function passes
 * one of these strings in the audit row metadata when emitting
 * `off_platform_outreach_blocked`.
 */
export const DEC_001_BLOCKED_REASONS = Object.freeze([
  "contact_email_missing",
  "contact_name_missing",
  "contact_incomplete",
  "binding_review_required",
  "disputed_being_named",
  "engagement_superseded",
  "engagement_expired",
  "engagement_cancelled",
  "match_progression_refused",
  "compliance_or_legal_hold",
  "unsafe_wording",
] as const);

export type Dec001BlockedReason = (typeof DEC_001_BLOCKED_REASONS)[number];

/**
 * Side-effect contract. Outreach (preview, send, block) on its own
 * never triggers any of the following — these are intentionally
 * enforced by absence in the edge function and pinned by tests, not
 * by runtime code in this module.
 */
export const DEC_001_OUTREACH_FORBIDDEN_SIDE_EFFECTS = Object.freeze([
  "atomic_generate_poi_v2",
  "atomic_generate_poi",
  "atomic_token_burn",
  "wad_seal",
  "atomic_wad_seal",
  "paystack",
  "create_payment",
  "credits.purchased",
] as const);
