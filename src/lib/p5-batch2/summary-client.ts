/**
 * P-5 Batch 2 — Stage 5 typed client for the scoped readiness-summary edge
 * function. Stage 5 surfaces (organisation/counterparty, director/UBO/invited
 * owner, funder, API-customer) MUST consume only this client. Direct selects
 * from `p5_batch2_*` tables are forbidden in Stage 5 components.
 *
 * The edge function performs server-side masking, provider-wording guard and
 * viewer scoping. This client adds no business rules; it is a typed transport.
 */
import { supabase } from "@/integrations/supabase/client";

export type P5B2SummaryViewer =
  | "organisation_user"
  | "counterparty"
  | "funder"
  | "api_user";

export interface P5B2ReadinessSummary {
  record_id: string;
  record_type: string;
  linked_entity_id: string;
  linked_transaction_id: string;
  kyb_status: string;
  kyc_status: string;
  evidence_status: string;
  evidence_rating: string;
  readiness_impact: "blocking" | "warning" | "review" | "ok" | "provider_dependent";
  missing_items: string[];
  blocker_count: number;
  warning_count: number;
  expiry_warning: boolean;
  expires_at: string;
  provider_dependency: boolean;
  provider_status: string;
  provider_live: boolean;
  provider_result_reference: string;
  reason_code: string;
  visible_reason: string;
  next_action:
    | "upload_evidence"
    | "resubmit_evidence"
    | "await_review"
    | "renew_evidence"
    | "await_provider_result"
    | "await_compliance_release"
    | "none";
  last_updated_at: string;
  audit_reference: string;
  evidence_pack_id: string;
  pack_status: string;
}

export interface FetchSummaryArgs {
  evidence_item_id: string;
  viewer: P5B2SummaryViewer;
}

export interface FetchSummaryResult {
  ok: boolean;
  data: P5B2ReadinessSummary | null;
  error: string | null;
}

const FUNCTION_NAME = "p5-batch2-readiness-summary";

export async function fetchP5B2ReadinessSummary(
  args: FetchSummaryArgs,
): Promise<FetchSummaryResult> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body: { evidence_item_id: args.evidence_item_id, viewer: args.viewer },
    });
    if (error) return { ok: false, data: null, error: error.message };
    return { ok: true, data: data as P5B2ReadinessSummary, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, data: null, error: msg };
  }
}

/** Stage 5 surfaces must never write directly to p5_batch2_* tables. The only
 * permitted mutation from a non-admin surface is uploading a new evidence
 * version via `p5b2UploadEvidenceVersion` (Stage 4 RPC wrapper). All other
 * actions are admin/compliance only. */
export const P5B2_STAGE5_ALLOWED_MUTATION_WRAPPERS = [
  "p5b2UploadEvidenceVersion",
] as const;
