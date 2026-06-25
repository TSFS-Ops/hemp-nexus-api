/**
 * P-5 Batch 3 — Stage 2 provider wording safety (pure TS).
 *
 * Stage 2 enforces the same wording contract Batch 2 introduced, scoped to
 * funder-facing surfaces. No edits to Batch 2 modules; this is parallel logic.
 */

export const P5B3_SAFE_PROVIDER_LABELS = [
  "Provider-ready",
  "Provider-ready, not live-provider verified",
  "External Provider Result Pending",
  "Provider result unavailable",
] as const;
export type P5B3SafeProviderLabel = (typeof P5B3_SAFE_PROVIDER_LABELS)[number];

export const P5B3_UNSAFE_PROVIDER_LABELS = [
  "Verified",
  "Guaranteed",
  "Compliance Passed",
  "Sanctions Cleared",
  "Bankable",
  "Provider Verified",
  "Investment Grade",
  "Due Diligence Complete",
] as const;
export type P5B3UnsafeProviderLabel = (typeof P5B3_UNSAFE_PROVIDER_LABELS)[number];

export interface P5B3WordingContext {
  provider_live: boolean;
  provider_result_reference: string | null;
  approved_manual_decision_ref: string | null;
}

export function isLabelSafe(label: string): boolean {
  return (P5B3_SAFE_PROVIDER_LABELS as readonly string[]).includes(label);
}

export function isLabelUnsafe(label: string): boolean {
  return (P5B3_UNSAFE_PROVIDER_LABELS as readonly string[]).includes(label);
}

export function isLabelAllowed(label: string, ctx: P5B3WordingContext): boolean {
  if (isLabelSafe(label)) return true;
  if (isLabelUnsafe(label)) {
    if (ctx.provider_live && ctx.provider_result_reference) return true;
    if (ctx.approved_manual_decision_ref) return true;
    return false;
  }
  return false;
}
