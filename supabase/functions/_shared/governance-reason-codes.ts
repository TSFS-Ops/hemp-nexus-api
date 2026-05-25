/**
 * governance-reason-codes.ts — Batch C: Reason-code normalisation (WARN-only).
 *
 * Purpose:
 *   - Map legacy / provider-shaped reason-code literals emitted by current
 *     production writers into controlled namespaces.
 *   - Expose the set of approved namespace prefixes that the canonical writer
 *     considers "known" for WARN-only validation.
 *
 * Scope:
 *   - This batch is NORMALISATION ONLY. The writer continues to log WARN-only
 *     for unknown codes and never throws on reason-code drift.
 *   - Document-specific reason codes are intentionally excluded (they belong
 *     to the separate AI/documentation-governance scope).
 */

/**
 * Approved namespace prefixes (the part before the first ":"). When a reason
 * code carries one of these prefixes it is treated as KNOWN by WARN-only
 * validation, even if the suffix is dynamic (e.g. `api:my-endpoint`,
 * `action:credit_burn`, `scope:org`).
 *
 * Unknown namespaces (e.g. `random:foo`) still WARN.
 * Unknown unnamespaced codes still WARN.
 */
export const APPROVED_REASON_CODE_NAMESPACES: ReadonlySet<string> = new Set([
  "legacy",
  "system",
  "payment",
  "api",
  "action",
  "scope",
]);

/**
 * Known legacy / provider literals → canonical namespaced equivalents.
 *
 * Keep this map authoritative — do not add entries here that should remain in
 * the David-approved business reason-code allow-list (those stay un-prefixed).
 *
 * Sourced from the current production emission sites:
 *   • supabase/functions/collapse/index.ts             (COLLAPSE_OK, COLLAPSE_FINAL)
 *   • supabase/functions/p3-wad/index.ts               (HARD_GATE_FAILED, DISCOVERY_GATE_FAILED, UBO_INCOMPLETE)
 *   • supabase/functions/_shared/token-metering.ts     (TOKEN_BURN_RPC_ERROR, INSUFFICIENT_TOKENS)
 *   • supabase/functions/token-purchase/index.ts       (charge.*, refund.*, chargeback.*, dispute.*)
 */
export const LEGACY_REASON_CODE_MAP: Readonly<Record<string, string>> = Object.freeze({
  // Collapse / finality
  "COLLAPSE_OK": "system:collapse_ok",
  "COLLAPSE_FINAL": "system:collapse_final",

  // Gate failures
  "HARD_GATE_FAILED": "system:hard_gate_failed",
  "DISCOVERY_GATE_FAILED": "system:discovery_gate_failed",
  "UBO_INCOMPLETE": "system:ubo_incomplete",

  // Credit / token
  "TOKEN_BURN_RPC_ERROR": "system:token_burn_rpc_error",
  "INSUFFICIENT_TOKENS": "credit_burn_not_allowed",

  // Payment / provider (Paystack-shaped event names)
  "charge.success": "payment:charge_success",
  "charge.failed": "payment:charge_failed",
  "refund.processed": "payment:refund_processed",
  "refund.partial:manual_review": "payment:refund_partial_manual_review",
  "refund.rejected:no_matching_purchase": "payment:refund_rejected_no_matching_purchase",
  "refund.rejected:org_mismatch": "payment:refund_rejected_org_mismatch",
  "chargeback.won": "payment:chargeback_won",
  "chargeback.lost": "payment:chargeback_lost",
  "dispute.create": "payment:dispute_create",
});

/**
 * Pure normaliser. Returns null for null/undefined/empty input. Returns the
 * canonical mapped value when the literal is in LEGACY_REASON_CODE_MAP.
 * Otherwise returns the trimmed input unchanged.
 *
 * Never throws. Safe to call on any string from any caller.
 */
export function normaliseReasonCode(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const mapped = LEGACY_REASON_CODE_MAP[trimmed];
  return mapped ?? trimmed;
}

/**
 * Returns the namespace prefix (text before first ":") or null if the code
 * has no namespace separator.
 */
export function reasonCodeNamespace(code: string | null | undefined): string | null {
  if (!code) return null;
  const idx = code.indexOf(":");
  if (idx <= 0) return null;
  return code.slice(0, idx);
}

/**
 * True when the code is in an approved namespace (prefix before ":" appears
 * in APPROVED_REASON_CODE_NAMESPACES). Unnamespaced codes return false from
 * this helper — the writer-level approval check combines this with the
 * David-approved allow-list.
 */
export function isApprovedNamespacedReasonCode(
  code: string | null | undefined,
): boolean {
  const ns = reasonCodeNamespace(code);
  if (!ns) return false;
  return APPROVED_REASON_CODE_NAMESPACES.has(ns);
}
