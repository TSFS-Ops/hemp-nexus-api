/**
 * P-5 Batch 4 Stage 6 — typed client for the Stage 3 execution-summary
 * edge function (funder audience).
 *
 * The funder surface (`/funder/p5-batch4/*`) calls ONLY this client for
 * reads, and ONLY `p5b4Funder.recordDecision` from `@/lib/p5-batch4/rpc`
 * for mutations. It NEVER touches `p5_batch4_*` tables directly, NEVER
 * imports admin or org-user wrappers, and NEVER hits a non-`funder`
 * audience. The edge function enforces:
 *   - funder org membership (p5b4_current_funder_org),
 *   - released-only scoping (non-revoked, not-expired releases),
 *   - the FUNDER_SAFE_FIELDS allowlist (no owner_user_id, finality,
 *     provider internals, audit, other funders' data, raw evidence).
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B4ExecutionStatus,
  P5B4FunderReleaseStatus,
  P5B4MilestoneKey,
  P5B4ProcessType,
  P5B4ReadinessStatus,
} from "./constants";

/**
 * Strictly the funder-safe projection. Mirrors `FUNDER_SAFE_FIELDS` in
 * the Stage 3 edge function, plus the per-release fields the funder
 * needs to identify their release and call `recordDecision`. NO
 * admin-only fields (`owner_user_id`, `finality_status`,
 * `provider_dependency_status`, internal notes, audit).
 */
export interface P5B4FunderCaseSummary {
  id: string;
  case_reference: string;
  process_type: P5B4ProcessType;
  execution_status: P5B4ExecutionStatus;
  current_milestone: P5B4MilestoneKey | null;
  readiness_status: P5B4ReadinessStatus;
  blocker_count: number;
  warning_count: number;
  funder_status: string | null;
  due_at: string | null;
  /** Release identity — required so the funder can record a decision. */
  release_id: string;
  access_expires_at: string;
  release_status: P5B4FunderReleaseStatus;
  download_allowed: boolean;
  nda_required: boolean;
  pack_reference: string;
}

export interface P5B4FunderSummaryResponse {
  audience: "funder";
  cases: P5B4FunderCaseSummary[];
}

const FN = "p5-batch4-execution-summary";

async function callFunder(qs: URLSearchParams): Promise<P5B4FunderSummaryResponse> {
  qs.set("audience", "funder");
  const { data, error } = await supabase.functions.invoke<P5B4FunderSummaryResponse>(
    `${FN}?${qs.toString()}`,
    { method: "GET" },
  );
  if (error) throw error;
  if (!data) throw new Error("empty_response");
  return data;
}

export const p5b4FunderClient = {
  listReleasedCases: () => callFunder(new URLSearchParams()),
  getReleasedCase: (caseId: string) =>
    callFunder(new URLSearchParams({ case_id: caseId })),
};
