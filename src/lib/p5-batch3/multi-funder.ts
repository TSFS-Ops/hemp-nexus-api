/**
 * P-5 Batch 3 — Stage 2 multi-funder separation (pure TS).
 *
 * Multiple funders may engage the same transaction. They MUST be invisible
 * to each other by default, and one funder's decisions MUST NOT change
 * another funder's status or access.
 */
import type { P5B3FunderStatus } from "./constants";

export interface P5B3FunderEngagement {
  funder_organisation_id: string;
  status: P5B3FunderStatus;
  notes_visible_to_funder: string[];
  request_thread_ids: string[];
  audit_log_ids: string[];
  released_pack_versions: number[];
  exit_outcome: string | null;
}

export interface P5B3MultiFunderView {
  transaction_id: string;
  engagements: P5B3FunderEngagement[];
}

/** Scope a multi-funder view to a single funder org. */
export function scopeToFunder(
  view: P5B3MultiFunderView,
  viewer_org: string,
): P5B3MultiFunderView {
  return {
    transaction_id: view.transaction_id,
    engagements: view.engagements.filter(
      (e) => e.funder_organisation_id === viewer_org,
    ),
  };
}

/** Apply one funder's decision; sibling funders' state must be untouched. */
export function applyFunderDecision(
  view: P5B3MultiFunderView,
  acting_org: string,
  newStatus: P5B3FunderStatus,
): P5B3MultiFunderView {
  return {
    transaction_id: view.transaction_id,
    engagements: view.engagements.map((e) =>
      e.funder_organisation_id === acting_org ? { ...e, status: newStatus } : e,
    ),
  };
}

/** Sanity check: no cross-funder leakage in a per-funder view. */
export function isIsolated(view: P5B3MultiFunderView, viewer_org: string): boolean {
  return view.engagements.every((e) => e.funder_organisation_id === viewer_org);
}
