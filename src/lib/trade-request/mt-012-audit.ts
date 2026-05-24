/**
 * MT-012 — Trade Request Archive (canonical audit-action SSOT, client mirror).
 *
 * MUST stay byte-identical to supabase/functions/_shared/mt-012-audit.ts
 * (enforced by scripts/check-mt012-audit-names.mjs).
 */
export const TRADE_REQUEST_MT012_AUDIT = {
  ARCHIVE_BLOCKED_ACTIVE_CHILDREN:
    "trade_request.archive_blocked_active_child_matches",
  ARCHIVED_ADMIN_OVERRIDE_ACTIVE_CHILDREN:
    "trade_request.archived_admin_override_active_children",
  ARCHIVED_NORMAL: "trade_request.archived_normal",
  ADMIN_EXCEPTION_HOLD_RELEASED:
    "trade_request.admin_exception_hold_released",
} as const;

export type TradeRequestMt012Audit =
  (typeof TRADE_REQUEST_MT012_AUDIT)[keyof typeof TRADE_REQUEST_MT012_AUDIT];

export const TRADE_REQUEST_MT012_AUDIT_NAMES: readonly TradeRequestMt012Audit[] =
  Object.freeze(Object.values(TRADE_REQUEST_MT012_AUDIT));

/** Owner-org-facing block message (verbatim per signed plan). */
export const MT012_BLOCK_MESSAGE =
  "This trade request cannot be archived because one or more linked matches are still active. Close, cancel, expire, or complete the linked matches before archiving this trade request.";

/** HQ admin override warning (verbatim per signed plan). */
export const MT012_ADMIN_OVERRIDE_WARNING =
  "This trade request has active child matches. Admin override will archive the parent trade request and place active child matches on exception hold. A reason is required and all actions will be audit logged.";

/** Marker key carried in `matches.metadata` while child is on exception hold. */
export const EXCEPTION_HOLD_MARKER = "parent_archived_admin_exception_hold";

/** Minimum reason length for admin override / release. */
export const MT012_MIN_REASON_LENGTH = 20;
