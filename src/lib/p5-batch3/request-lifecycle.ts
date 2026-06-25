/**
 * P-5 Batch 3 — Stage 2 funder request lifecycle (pure TS).
 */
import type { P5B3RequestStatus } from "./constants";

const TRANSITIONS: Record<P5B3RequestStatus, P5B3RequestStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["admin_review", "withdrawn"],
  admin_review: ["approved_to_company", "rejected", "withdrawn"],
  approved_to_company: ["assigned", "withdrawn"],
  assigned: ["response_pending", "withdrawn"],
  response_pending: ["answered", "withdrawn"],
  answered: ["follow_up_requested", "closed"],
  follow_up_requested: ["admin_review", "closed"],
  rejected: ["closed"],
  closed: [],
  withdrawn: [],
};

export function canTransitionRequest(
  from: P5B3RequestStatus,
  to: P5B3RequestStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextRequestStatuses(
  from: P5B3RequestStatus,
): P5B3RequestStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export interface P5B3RequestText {
  original_text: string;
  external_text?: string | null;
}

/** Admin may edit external wording but must preserve original. */
export function applyAdminExternalEdit(
  prior: P5B3RequestText,
  newExternal: string,
): P5B3RequestText {
  return {
    original_text: prior.original_text, // immutable
    external_text: newExternal,
  };
}
