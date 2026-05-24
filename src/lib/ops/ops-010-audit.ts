/**
 * OPS-010 — Canonical demo-workspace audit names (browser SSOT).
 *
 * Mirrored in `supabase/functions/_shared/ops-010-audit.ts`. Both files MUST
 * stay byte-identical for the constant set; `scripts/check-ops-010-audit-names.mjs`
 * enforces this at prebuild.
 */

export const OPS_010_AUDIT = {
  WORKSPACE_CREATED: "ops.demo_workspace_created",
  WORKSPACE_RESET: "ops.demo_workspace_reset",
  WORKSPACE_ARCHIVED: "ops.demo_workspace_archived",
  SIDE_EFFECT_SUPPRESSED: "ops.demo_mode_side_effect_suppressed",
  DATA_ACCESSED: "ops.demo_data_accessed",
  EXTERNAL_CALL_BLOCKED: "ops.demo_external_call_blocked",
  CREDIT_BURN_SIMULATED: "ops.demo_credit_burn_simulated",
  PAYMENT_EVENT_SIMULATED: "ops.demo_payment_event_simulated",
  COMPLIANCE_CALL_SIMULATED: "ops.demo_compliance_call_simulated",
  OUTREACH_BLOCKED: "ops.demo_outreach_blocked",
  EXPORT_MARKED: "ops.demo_export_marked",
  BOUNDARY_VIOLATION_REJECTED: "ops.demo_boundary_violation_rejected",
} as const;

export type Ops010AuditName = (typeof OPS_010_AUDIT)[keyof typeof OPS_010_AUDIT];

export const OPS_010_MIN_REASON_LENGTH = 20;

export const OPS_010_DEMO_BANNER_COPY =
  "Demo workspace — no live emails, no live payments, no live compliance calls.";

export const OPS_010_DEMO_WATERMARK = "DEMO — NOT A PRODUCTION ARTEFACT";
