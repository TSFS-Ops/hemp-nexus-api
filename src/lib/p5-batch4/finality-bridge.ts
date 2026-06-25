/**
 * P-5 Batch 4 Stage 7 — Finality bridge (pure, opt-in).
 *
 * This module decides whether a downstream system may treat a case as
 * "final". It MUST NOT mark anything final on its own:
 *   - finality is only ever set by `p5b4_record_finality_v1` (admin, SQL).
 *   - this bridge only reports whether the conditions are met for a
 *     downstream consumer to MIRROR that finality.
 *
 * Opt-in design: the caller passes `enable_bridge=false` and gets a
 * safe negative result. The bridge never side-effects.
 */
import type { P5B4FinalityOutcome, P5B4RoleKey } from "./constants";
import { P5B4_TERMINAL_FINALITY_OUTCOMES } from "./finality";

export interface P5B4FinalityBridgeInput {
  enable_bridge: boolean;
  has_admin_recorded_finality: boolean;
  final_outcome: P5B4FinalityOutcome | null;
  finality_summary: string | null;
  approval_reference: string | null;
  audit_reference: string | null;
  actor_role: P5B4RoleKey | null;
}

export interface P5B4FinalityBridgeResult {
  mirror_allowed: boolean;
  reasons: string[];
  mirrored_outcome: P5B4FinalityOutcome | null;
}

export function evaluateFinalityBridge(
  input: P5B4FinalityBridgeInput,
): P5B4FinalityBridgeResult {
  const reasons: string[] = [];
  if (!input.enable_bridge) reasons.push("bridge_disabled");
  if (!input.has_admin_recorded_finality) reasons.push("finality_not_recorded_by_admin");
  if (input.actor_role !== "platform_admin") reasons.push("actor_not_platform_admin");
  if (!input.final_outcome) reasons.push("missing_final_outcome");
  else if (!P5B4_TERMINAL_FINALITY_OUTCOMES.has(input.final_outcome)) {
    reasons.push("non_terminal_outcome");
  }
  if (!input.finality_summary || input.finality_summary.trim().length < 4) {
    reasons.push("missing_finality_summary");
  }
  if (!input.approval_reference) reasons.push("missing_approval_reference");
  if (!input.audit_reference) reasons.push("missing_audit_reference");

  const mirror_allowed = reasons.length === 0;
  return {
    mirror_allowed,
    reasons,
    mirrored_outcome: mirror_allowed ? input.final_outcome : null,
  };
}
