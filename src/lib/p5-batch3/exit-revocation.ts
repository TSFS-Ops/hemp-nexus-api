/**
 * P-5 Batch 3 — Stage 2 exit & revocation rules (pure TS).
 */
import type { P5B3ExitReason } from "./constants";

export type P5B3ExitTrigger =
  | "voluntary_exit"
  | "admin_revocation"
  | "expiry"
  | "transaction_closed"
  | "funding_completed"
  | "dormant_no_response";

export const TRIGGER_TO_REASON: Record<P5B3ExitTrigger, P5B3ExitReason> = {
  voluntary_exit: "funder_withdrawn",
  admin_revocation: "admin_revoked",
  expiry: "access_expired",
  transaction_closed: "transaction_closed",
  funding_completed: "funding_completed",
  dormant_no_response: "no_response",
};

export interface P5B3ReinstatementInput {
  actor_role: string;
  reason: string | null;
  new_expires_at: string | null;
}

export interface P5B3ReinstatementDecision {
  allowed: boolean;
  reason?: "not_platform_admin" | "missing_reason" | "missing_expiry";
}

export function canReinstate(input: P5B3ReinstatementInput): P5B3ReinstatementDecision {
  if (input.actor_role !== "platform_admin") {
    return { allowed: false, reason: "not_platform_admin" };
  }
  if (!input.reason || input.reason.trim().length === 0) {
    return { allowed: false, reason: "missing_reason" };
  }
  if (!input.new_expires_at) {
    return { allowed: false, reason: "missing_expiry" };
  }
  return { allowed: true };
}
