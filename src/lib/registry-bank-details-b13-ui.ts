/**
 * Batch 13B — UI copy SSOT for the bank-detail submission/review flow.
 * Separate from src/lib/registry-bank-details-b13.ts so the existing B13
 * backend parity guard remains pinned; this file only adds UI strings.
 * Pinned by: scripts/check-batch-13b-ui-no-verified.mjs
 */

import type { RegistryBankDetailB13SubmissionStatus } from "./registry-bank-details-b13";

export const REGISTRY_BANK_DETAIL_B13_UI_NOT_VERIFIED_BADGE = "Not verified";

/**
 * Public-facing labels for every B13 submission status. NONE of these
 * imply verification — pinned by check-batch-13b-ui-no-verified.mjs.
 */
export const REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL: Record<
  RegistryBankDetailB13SubmissionStatus,
  string
> = {
  draft: "Draft",
  submitted: "Submitted for review",
  evidence_required: "Evidence required",
  under_review: "Under review",
  more_evidence_requested: "More evidence requested",
  evidence_resubmitted: "Evidence resubmitted",
  captured_unverified: "Captured but not verified",
  rejected: "Rejected",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  revocation_requested: "Revocation requested",
  revoked: "Revoked",
  disputed: "Disputed",
  expired: "Expired",
  superseded: "Superseded",
};

export const REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER =
  "You need approved authority for this action before bank details can be submitted.";

export const REGISTRY_BANK_DETAIL_B13_UI_DECLARATION =
  "I confirm that I am authorised to submit these bank details, that they are submitted for review only, that Izenzo has not vetted the bank details at submission stage, and that false or unauthorised submissions may be rejected, revoked or escalated.";

export const REGISTRY_BANK_DETAIL_B13_UI_RAW_BLOCKED_NOTICE =
  "Raw bank details are never displayed on user pages. Only a masked summary is shown after submission.";

export const REGISTRY_BANK_DETAIL_B13_UI_UNMASK_NOTICE =
  "Unmask access is restricted to platform admins and compliance owners. Every unmask request requires a reason and is recorded in the audit trail.";

export const REGISTRY_BANK_DETAIL_B13_UI_RISK_LABEL: Record<string, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk — compliance review",
  blocked: "Blocked — acceptance disabled",
};
