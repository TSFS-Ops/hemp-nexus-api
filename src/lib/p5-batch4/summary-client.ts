/**
 * P-5 Batch 4 Stage 4 — typed client for the Stage 3 execution-summary
 * edge function. Admin pages call this for reads instead of touching
 * batch-4 tables directly. Mutations always go through
 * `src/lib/p5-batch4/rpc.ts`.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B4BlockerKey,
  P5B4BlockerStatus,
  P5B4BlockerType,
  P5B4EvidenceStatus,
  P5B4ExecutionStatus,
  P5B4MandatoryType,
  P5B4MilestoneKey,
  P5B4MilestoneStatus,
  P5B4ProcessType,
  P5B4ReadinessStatus,
} from "./constants";

export interface P5B4AdminCaseSummary {
  id: string;
  case_reference: string;
  process_type: P5B4ProcessType;
  execution_status: P5B4ExecutionStatus;
  readiness_status: P5B4ReadinessStatus;
  current_milestone: P5B4MilestoneKey | null;
  blocker_count: number;
  warning_count: number;
  due_at: string | null;
  funder_status: string | null;
  finality_status: string | null;
  provider_dependency_status: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface P5B4AdminMilestone {
  id: string;
  milestone_key: P5B4MilestoneKey;
  milestone_name: string;
  milestone_status: P5B4MilestoneStatus;
  mandatory_type: P5B4MandatoryType;
  overdue_label: string;
  due_at: string | null;
  completed_at: string | null;
  sort_order: number;
}

export interface P5B4AdminBlocker {
  id: string;
  blocker_key: P5B4BlockerKey;
  blocker_name: string;
  blocker_type: P5B4BlockerType;
  blocker_status: P5B4BlockerStatus;
  external_safe_label: string;
  internal_detail: string | null;
  opened_at: string;
  resolved_at: string | null;
}

export interface P5B4AdminEvidence {
  id: string;
  evidence_type: string;
  evidence_label: string;
  evidence_status: P5B4EvidenceStatus;
  requirement_type: P5B4MandatoryType;
  requested_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
}

export interface P5B4AdminAuditEvent {
  id: string;
  event_type: string;
  external_safe: string;
  internal: string | null;
  actor_user_id: string | null;
  created_at: string;
}

export interface P5B4AdminSummaryResponse {
  audience: "admin";
  cases: P5B4AdminCaseSummary[];
  milestones?: P5B4AdminMilestone[];
  blockers?: P5B4AdminBlocker[];
  evidence?: P5B4AdminEvidence[];
  audit?: P5B4AdminAuditEvent[];
}

const FN = "p5-batch4-execution-summary";

async function callAdmin(qs: URLSearchParams): Promise<P5B4AdminSummaryResponse> {
  qs.set("audience", "admin");
  const { data, error } = await supabase.functions.invoke<P5B4AdminSummaryResponse>(
    `${FN}?${qs.toString()}`,
    { method: "GET" },
  );
  if (error) throw error;
  if (!data) throw new Error("empty_response");
  return data;
}

export const p5b4SummaryClient = {
  listAdminCases: () => callAdmin(new URLSearchParams()),
  getAdminCase: (
    caseId: string,
    include: Array<"milestones" | "blockers" | "evidence" | "audit"> = [
      "milestones",
      "blockers",
      "evidence",
      "audit",
    ],
  ) =>
    callAdmin(
      new URLSearchParams({ case_id: caseId, include: include.join(",") }),
    ),
};
