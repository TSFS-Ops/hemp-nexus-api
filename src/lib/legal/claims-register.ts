/**
 * DEC-010 Phase 1 - Investor / client / public claims register.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-010.
 *
 * This module is the static SSOT for any claim Izenzo makes about its
 * own capabilities on public, marketing, docs, UI, email, generated
 * document, or investor-facing surfaces.
 *
 * Phase 1 introduces an explicit four-tier classification model:
 *
 *   - `approved_now`             Claim is true today and may be used
 *                                without qualification on the listed
 *                                surfaces.
 *   - `approved_after_hardening` Claim is genuine direction-of-travel
 *                                and may be used ONLY when qualified as
 *                                "in development" / "planned hardening".
 *                                It must never be presented as live.
 *   - `prohibited`               Claim is forbidden outright. Static
 *                                guards (`scripts/check-legal-claims.mjs`
 *                                and `scripts/check-dec010-generated-doc-
 *                                claims.mjs`) and the runtime
 *                                `assertClaimSafe` helper block them.
 *   - `manual_review_required`   Claim is context-sensitive (e.g.
 *                                "enterprise-ready"): truthful in some
 *                                contexts, misleading in others.
 *                                Requires human review before public
 *                                use. Phase 1 does NOT auto-approve or
 *                                auto-block these phrases - it merely
 *                                surfaces them as a known review queue.
 *                                The Phase 2 admin approval workflow
 *                                (UI + emissions) is explicitly NOT
 *                                implemented here.
 *
 * Phase 1 also pins three canonical DEC-010 audit action constants
 * (`claims.claim_evaluated`, `claims.unapproved_claim_blocked`,
 * `claims.claim_approved_by_admin`). Only the first two have any
 * real-world emission point today; `claims.claim_approved_by_admin` is
 * a Phase 2 placeholder and is asserted by tests to have NO runtime
 * emission anywhere in the repo (no fake approval workflow).
 */

export type ClaimClassification =
  | "approved_now"
  | "approved_after_hardening"
  | "prohibited"
  | "manual_review_required";

export const CLAIM_CLASSIFICATIONS: readonly ClaimClassification[] = [
  "approved_now",
  "approved_after_hardening",
  "prohibited",
  "manual_review_required",
] as const;

export type ClaimSurface =
  | "marketing"
  | "docs"
  | "ui"
  | "email"
  | "generated_document"
  | "investor";

export interface ClaimEntry {
  id: string;
  text: string;
  classification: ClaimClassification;
  surfaces: ClaimSurface[];
  /** Optional human note explaining the tier choice. */
  rationale?: string;
}

// ─────────────────────────────────────────────────────────────────────
// approved_now - true today, may be used unqualified
// ─────────────────────────────────────────────────────────────────────
export const APPROVED_NOW_CLAIMS: ClaimEntry[] = [
  { id: "workflow.governed", text: "Governed trade workflow.", classification: "approved_now", surfaces: ["marketing", "ui", "docs"] },
  { id: "workflow.recording", text: "Record, manage, and progress trade intent.", classification: "approved_now", surfaces: ["marketing", "ui"] },
  { id: "poi.pre-acceptance", text: "POI before counterparty acceptance is an initiator-generated intent record awaiting counterparty confirmation.", classification: "approved_now", surfaces: ["marketing", "docs", "ui"] },
  { id: "poi.post-acceptance", text: "After counterparty acceptance, a POI is an accepted POI / mutual intent record - not a final contract or completed transaction.", classification: "approved_now", surfaces: ["marketing", "docs", "ui"] },
  { id: "admin.hold-points", text: "Admin-controlled hold-points for unknown or off-platform counterparties.", classification: "approved_now", surfaces: ["marketing", "docs"] },
  { id: "billing.credits", text: "Pay-as-you-go credit billing with full usage history.", classification: "approved_now", surfaces: ["marketing", "ui"] },
  { id: "hash.recorded", text: "SHA-256 hash recorded on critical state transitions. Coverage is being progressively hardened.", classification: "approved_now", surfaces: ["marketing", "docs"] },
  { id: "demo.controlled", text: "Demo environments use controlled demo data and are not representations of customer activity.", classification: "approved_now", surfaces: ["marketing"] },
];

// ─────────────────────────────────────────────────────────────────────
// approved_after_hardening - direction-of-travel; must be qualified
// ─────────────────────────────────────────────────────────────────────
export const APPROVED_AFTER_HARDENING_CLAIMS: ClaimEntry[] = [
  { id: "status.public", text: "Public status feed is in development.", classification: "approved_after_hardening", surfaces: ["marketing"] },
  { id: "screening.continuous", text: "Continuous re-screening is planned hardening.", classification: "approved_after_hardening", surfaces: ["marketing", "docs"] },
  { id: "telemetry.realtime", text: "Real-time programme telemetry is in development.", classification: "approved_after_hardening", surfaces: ["marketing"] },
  { id: "regulator.export", text: "Independent regulator export endpoints are planned hardening.", classification: "approved_after_hardening", surfaces: ["marketing"] },
];

// ─────────────────────────────────────────────────────────────────────
// manual_review_required - context-sensitive; needs human approval
// ─────────────────────────────────────────────────────────────────────
export const MANUAL_REVIEW_REQUIRED_CLAIMS: ClaimEntry[] = [
  { id: "review.enterprise-ready", text: "enterprise-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"], rationale: "Truthful only in defined enterprise contexts; must not imply blanket enterprise certification." },
  { id: "review.production-ready", text: "production-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"], rationale: "Permitted for individual hardened surfaces; misleading as a platform-wide claim." },
  { id: "review.regulator-ready", text: "regulator-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"], rationale: "Allowed for specific export/audit endpoints; never as a blanket regulator certification." },
  { id: "review.bank-ready", text: "bank-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"], rationale: "Acceptable for export packs; misleading as a banking-licence equivalent." },
  { id: "review.institution-ready", text: "institution-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.audit-ready", text: "audit-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.compliance-ready", text: "compliance-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.settlement-ready", text: "settlement-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.execution-ready", text: "execution-ready", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.fully-verified", text: "fully verified", classification: "manual_review_required", surfaces: ["marketing", "investor", "ui"] },
  { id: "review.trusted-counterparty-network", text: "trusted counterparty network", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
  { id: "review.verified-trade-network", text: "verified trade network", classification: "manual_review_required", surfaces: ["marketing", "investor"] },
];

// ─────────────────────────────────────────────────────────────────────
// prohibited - forbidden outright; blocked by static + runtime guards
// ─────────────────────────────────────────────────────────────────────
export const PROHIBITED_CLAIMS: ClaimEntry[] = [
  { id: "prohibited.replaces-legal-review", text: "Izenzo replaces legal review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-financial-review", text: "Izenzo replaces financial review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-regulatory-review", text: "Izenzo replaces regulatory review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-human-review", text: "Izenzo replaces human review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-legal-review-bare", text: "replaces legal review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-financial-review-bare", text: "replaces financial review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-regulatory-review-bare", text: "replaces regulatory review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.replaces-human-review-bare", text: "replaces human review", classification: "prohibited", surfaces: [] },
  { id: "prohibited.production-grade-audit", text: "production-grade audit", classification: "prohibited", surfaces: [] },
  { id: "prohibited.regulator-ready-audit", text: "regulator-ready audit", classification: "prohibited", surfaces: [] },
  { id: "prohibited.demo-live-traction", text: "demo data is live traction", classification: "prohibited", surfaces: [] },
  { id: "prohibited.test-live-traction", text: "test data is live traction", classification: "prohibited", surfaces: [] },
  { id: "prohibited.controlled-demo-live-commercial", text: "controlled demo records are live commercial traction", classification: "prohibited", surfaces: [] },
  { id: "prohibited.live-production-from-demo", text: "live production traction from demo records", classification: "prohibited", surfaces: [] },
];

// ─────────────────────────────────────────────────────────────────────
// Backward-compat exports (older guards/imports still rely on these).
// ─────────────────────────────────────────────────────────────────────
export interface ApprovedClaim {
  id: string;
  text: string;
  surfaces: string[];
}

export const APPROVED_CLAIMS: ApprovedClaim[] = APPROVED_NOW_CLAIMS.map(
  ({ id, text, surfaces }) => ({ id, text, surfaces }),
);
export const IN_DEVELOPMENT_CLAIMS: ApprovedClaim[] =
  APPROVED_AFTER_HARDENING_CLAIMS.map(({ id, text, surfaces }) => ({
    id,
    text,
    surfaces,
  }));

// ─────────────────────────────────────────────────────────────────────
// Combined view + helpers
// ─────────────────────────────────────────────────────────────────────
export const ALL_CLAIM_ENTRIES: ClaimEntry[] = [
  ...APPROVED_NOW_CLAIMS,
  ...APPROVED_AFTER_HARDENING_CLAIMS,
  ...MANUAL_REVIEW_REQUIRED_CLAIMS,
  ...PROHIBITED_CLAIMS,
];

export function classifyClaimText(
  text: string,
): ClaimClassification | "unknown" {
  if (!text) return "unknown";
  const lower = text.toLowerCase();
  for (const entry of PROHIBITED_CLAIMS) {
    if (lower.includes(entry.text.toLowerCase())) return "prohibited";
  }
  for (const entry of MANUAL_REVIEW_REQUIRED_CLAIMS) {
    if (lower.includes(entry.text.toLowerCase())) return "manual_review_required";
  }
  for (const entry of APPROVED_NOW_CLAIMS) {
    if (entry.text && lower.includes(entry.text.toLowerCase())) return "approved_now";
  }
  for (const entry of APPROVED_AFTER_HARDENING_CLAIMS) {
    if (entry.text && lower.includes(entry.text.toLowerCase()))
      return "approved_after_hardening";
  }
  return "unknown";
}

/**
 * Defensive check: a claim that is only `approved_after_hardening` MUST
 * NOT be re-classified or stored as `approved_now`. Used by tests to
 * prevent silent tier promotion drift.
 */
export function isApprovedNowId(id: string): boolean {
  return APPROVED_NOW_CLAIMS.some((c) => c.id === id);
}
export function isApprovedAfterHardeningId(id: string): boolean {
  return APPROVED_AFTER_HARDENING_CLAIMS.some((c) => c.id === id);
}

// ─────────────────────────────────────────────────────────────────────
// DEC-010 canonical audit action constants.
//
// `claims.claim_evaluated` - emitted whenever the platform evaluates a
//   claim against this register (runtime call to assertClaimSafe OR
//   static call during prebuild). The Phase 1 surface for evaluation
//   is the `assertClaimSafe` helper and the prebuild guards; an emit
//   adapter is exposed below so future server-side callers can attach
//   their own audit emitter without re-coining the action name.
//
// `claims.unapproved_claim_blocked` - emitted when an evaluation
//   decision blocks a claim. Already in use today by the POI /
//   Pending Engagement claim guard.
//
// `claims.claim_approved_by_admin` - Phase 2 placeholder. There is NO
//   admin approval workflow in this repo. The constant exists so that
//   future approval emit points have a fixed SSOT, but tests assert
//   that no runtime emission of this string exists outside this SSOT
//   and the DEC-010 test file. Faking the workflow is forbidden.
// ─────────────────────────────────────────────────────────────────────
export const CLAIMS_CLAIM_EVALUATED = "claims.claim_evaluated" as const;
export const CLAIMS_UNAPPROVED_CLAIM_BLOCKED =
  "claims.unapproved_claim_blocked" as const;
export const CLAIMS_CLAIM_APPROVED_BY_ADMIN =
  "claims.claim_approved_by_admin" as const;

export const DEC010_AUDIT_ACTIONS = [
  CLAIMS_CLAIM_EVALUATED,
  CLAIMS_UNAPPROVED_CLAIM_BLOCKED,
  CLAIMS_CLAIM_APPROVED_BY_ADMIN,
] as const;

export type Dec010AuditAction = (typeof DEC010_AUDIT_ACTIONS)[number];

/** Phase marker - Phase 2 admin approval workflow is NOT implemented. */
export const DEC010_PHASE = 1 as const;
export const DEC010_ADMIN_APPROVAL_WORKFLOW_IMPLEMENTED = false as const;

/**
 * Canonical emit helper for `claims.claim_evaluated`. Callers supply
 * their own audit emitter (server-side or client-side); the helper
 * does not perform IO itself, so it is safe to import from any
 * surface without dragging supabase/edge dependencies.
 */
export function recordClaimEvaluated(
  emit: (
    action: typeof CLAIMS_CLAIM_EVALUATED,
    metadata: Record<string, unknown>,
  ) => void,
  metadata: {
    surface: string;
    classification: ClaimClassification | "unknown";
    matched_ids?: string[];
    text_sample?: string;
  },
): void {
  emit(CLAIMS_CLAIM_EVALUATED, metadata);
}

/**
 * Canonical emit helper for `claims.unapproved_claim_blocked`. Mirrors
 * the existing POI/Pending Engagement guard emission contract.
 */
export function recordUnapprovedClaimBlocked(
  emit: (
    action: typeof CLAIMS_UNAPPROVED_CLAIM_BLOCKED,
    metadata: Record<string, unknown>,
  ) => void,
  metadata: {
    surface: string;
    blocked_terms: string[];
    text_sample?: string;
  },
): void {
  emit(CLAIMS_UNAPPROVED_CLAIM_BLOCKED, metadata);
}
