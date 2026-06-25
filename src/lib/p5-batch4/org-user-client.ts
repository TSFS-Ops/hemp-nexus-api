/**
 * P-5 Batch 4 Stage 5 — typed client for the Stage 3 execution-summary
 * edge function (organisation / counterparty user audience).
 *
 * The org-user surface (`/desk/p5-batch4/*`) calls ONLY this client for
 * reads, and ONLY `p5b4OrgUser.*` from `@/lib/p5-batch4/rpc` for
 * mutations. It never touches `p5_batch4_*` tables directly and never
 * imports admin / funder wrappers.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B4BlockerStatus,
  P5B4EvidenceStatus,
  P5B4ExecutionStatus,
  P5B4MandatoryType,
  P5B4MilestoneKey,
  P5B4MilestoneStatus,
  P5B4ProcessType,
  P5B4ReadinessStatus,
} from "./constants";

/**
 * The strict task-focused projection an organisation / counterparty
 * user is allowed to see. Mirrors `ORG_USER_SAFE_FIELDS` in the edge
 * function. Admin-only fields (`owner_user_id`, `funder_status`,
 * `finality_status`, `provider_dependency_status`) are intentionally
 * absent.
 */
export interface P5B4OrgUserCaseSummary {
  id: string;
  case_reference: string;
  process_type: P5B4ProcessType;
  execution_status: P5B4ExecutionStatus;
  readiness_status: P5B4ReadinessStatus;
  current_milestone: P5B4MilestoneKey | null;
  blocker_count: number;
  warning_count: number;
  due_at: string | null;
}

export interface P5B4OrgUserMilestone {
  id: string;
  milestone_key: P5B4MilestoneKey;
  milestone_name: string;
  milestone_status: P5B4MilestoneStatus;
  mandatory_type: P5B4MandatoryType;
  overdue_label: string;
  due_at: string | null;
  sort_order: number;
}

export interface P5B4OrgUserBlockerNotice {
  id: string;
  blocker_name: string;
  blocker_status: P5B4BlockerStatus;
  /** External-safe label only. Internal detail is never returned. */
  external_safe_label: string;
  opened_at: string;
  resolved_at: string | null;
}

export interface P5B4OrgUserEvidenceTask {
  id: string;
  evidence_type: string;
  evidence_label: string;
  evidence_status: P5B4EvidenceStatus;
  requirement_type: P5B4MandatoryType;
  requested_at: string | null;
  /** Reviewer feedback shown to the org user (no internal notes). */
  reject_reason: string | null;
}

export interface P5B4OrgUserSummaryResponse {
  audience: "org_user";
  cases: P5B4OrgUserCaseSummary[];
  milestones?: P5B4OrgUserMilestone[];
  blockers?: P5B4OrgUserBlockerNotice[];
  evidence?: P5B4OrgUserEvidenceTask[];
}

const FN = "p5-batch4-execution-summary";

async function callOrgUser(
  qs: URLSearchParams,
): Promise<P5B4OrgUserSummaryResponse> {
  qs.set("audience", "org_user");
  const { data, error } = await supabase.functions.invoke<P5B4OrgUserSummaryResponse>(
    `${FN}?${qs.toString()}`,
    { method: "GET" },
  );
  if (error) throw error;
  if (!data) throw new Error("empty_response");
  return data;
}

export const p5b4OrgUserClient = {
  listMyCases: () => callOrgUser(new URLSearchParams()),
  getMyCase: (
    caseId: string,
    include: Array<"milestones" | "blockers" | "evidence"> = [
      "milestones",
      "blockers",
      "evidence",
    ],
  ) =>
    callOrgUser(
      new URLSearchParams({ case_id: caseId, include: include.join(",") }),
    ),
};
