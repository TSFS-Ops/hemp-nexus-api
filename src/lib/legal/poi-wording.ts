/**
 * DEC-006 - POI must not be described as binding before counterparty
 * acceptance. Signed pre-acceptance and post-acceptance wording.
 */

import { FORBIDDEN_PRE_ACCEPTANCE_TERMS, findForbiddenTerms } from "./forbidden-terms";

export const DRAFT_POI_LABEL =
  "Draft POI - initiator-generated intent record, awaiting counterparty confirmation.";

export const ACCEPTED_POI_LABEL = "Accepted POI - mutual intent recorded.";

export const POST_ACCEPTANCE_QUALIFIER =
  "Proof of mutual intention recorded. WaD, execution, and finality remain subject to the next required workflow steps.";

export const UNSAFE_POI_WARNING =
  "This POI wording is not approved. A POI may not be described as binding, mutual, accepted, sealed, complete, or final before counterparty acceptance.";

export interface PoiLabelOpts {
  accepted: boolean;
  bilateral?: boolean;
}

export interface PoiLabel {
  label: string;
  qualifier?: string;
  auditKey: "legal.poi_binding_wording_applied";
  state: "draft" | "accepted";
}

export function getPoiLabel({ accepted, bilateral }: PoiLabelOpts): PoiLabel {
  if (!accepted) {
    return {
      label: DRAFT_POI_LABEL,
      auditKey: "legal.poi_binding_wording_applied",
      state: "draft",
    };
  }
  return {
    label: ACCEPTED_POI_LABEL,
    qualifier: bilateral === false ? undefined : POST_ACCEPTANCE_QUALIFIER,
    auditKey: "legal.poi_binding_wording_applied",
    state: "accepted",
  };
}

import type { AssertResult } from "./pre-acceptance-wording";

export function assertPoiWordingSafe(
  text: string,
  context?: { accepted?: boolean; surface?: string },
): AssertResult {
  // After counterparty acceptance, "accepted" and "mutual" are allowed.
  if (context?.accepted) {
    return { ok: true, blockedTerms: [] };
  }
  const blockedTerms = findForbiddenTerms(text, FORBIDDEN_PRE_ACCEPTANCE_TERMS);
  return blockedTerms.length === 0
    ? { ok: true, blockedTerms: [] }
    : { ok: false, blockedTerms, warning: UNSAFE_POI_WARNING };
}
