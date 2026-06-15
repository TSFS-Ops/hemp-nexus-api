/**
 * DEC-007 / PAY-009 - canonical audit names (TS mirror).
 * Must remain string-identical to supabase/functions/_shared/dec-007-pay-009-audit.ts.
 * Pinned by scripts/check-dec-007-pay-009-audit-names.mjs.
 */

// DEC-007 - Refund governance
export const BILLING_REFUND_REQUESTED = "billing.refund_requested" as const;
export const BILLING_REFUND_APPROVED = "billing.refund_approved" as const;
export const BILLING_REFUND_DECLINED = "billing.refund_declined" as const;
export const BILLING_REFUND_BLOCKED_CREDITS_USED =
  "billing.refund_blocked_credits_used" as const;
export const BILLING_REFUND_BLOCKED_CREDITS_EXPIRED =
  "billing.refund_blocked_credits_expired" as const;
export const BILLING_CREDIT_ADJUSTMENT_RECORDED =
  "billing.credit_adjustment_recorded" as const;

// PAY-009 - Payment dispute / chargeback governance
export const BILLING_PAYMENT_DISPUTE_DETECTED =
  "billing.payment_dispute_detected" as const;
export const BILLING_CREDITS_FROZEN_DUE_TO_DISPUTE =
  "billing.credits_frozen_due_to_dispute" as const;
export const BILLING_USED_CREDITS_MARKED_BILLING_REVIEW =
  "billing.used_credits_marked_billing_review" as const;
export const BILLING_PAYMENT_DISPUTE_RESOLVED_WON =
  "billing.payment_dispute_resolved_won" as const;
export const BILLING_PAYMENT_DISPUTE_RESOLVED_LOST =
  "billing.payment_dispute_resolved_lost" as const;
export const BILLING_ORG_BILLING_HOLD_APPLIED =
  "billing.org_billing_hold_applied" as const;
export const BILLING_ORG_BILLING_HOLD_RELEASED =
  "billing.org_billing_hold_released" as const;

export const DEC_007_PAY_009_AUDIT_NAMES = [
  BILLING_REFUND_REQUESTED,
  BILLING_REFUND_APPROVED,
  BILLING_REFUND_DECLINED,
  BILLING_REFUND_BLOCKED_CREDITS_USED,
  BILLING_REFUND_BLOCKED_CREDITS_EXPIRED,
  BILLING_CREDIT_ADJUSTMENT_RECORDED,
  BILLING_PAYMENT_DISPUTE_DETECTED,
  BILLING_CREDITS_FROZEN_DUE_TO_DISPUTE,
  BILLING_USED_CREDITS_MARKED_BILLING_REVIEW,
  BILLING_PAYMENT_DISPUTE_RESOLVED_WON,
  BILLING_PAYMENT_DISPUTE_RESOLVED_LOST,
  BILLING_ORG_BILLING_HOLD_APPLIED,
  BILLING_ORG_BILLING_HOLD_RELEASED,
] as const;
