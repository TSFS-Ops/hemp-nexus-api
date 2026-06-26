/**
 * P-5 Screening — Phase 5 UI data layer.
 *
 * The only surface UI code is allowed to use to talk to the screening backend.
 *
 *   - Reads go exclusively through Phase 4 `p5scr_api_*` projection RPCs.
 *   - No direct `from('p5scr_*')` table access from the UI.
 *   - No SSOT-forbidden external field is exposed by these types.
 *
 * The Phase 5 UI guard scans `src/pages/admin/p5-screening` and
 * `src/components/p5-screening` to ensure no other access pattern is used.
 */
import { supabase } from "@/integrations/supabase/client";

export interface P5ScrBlocker {
  affected_party?: string;
  affected_check: string;
  readiness_status: string | null;
  last_checked_at: string | null;
  expires_at: string | null;
  admin_review_required?: boolean;
  provider_pending?: boolean;
  retry_pending?: boolean;
}

export interface P5ScrSubjectStatus {
  ready: boolean;
  blockers: P5ScrBlocker[];
  admin_review_required: boolean;
  provider_pending: boolean;
  retry_pending: boolean;
}

export interface P5ScrGateReadiness {
  ready: boolean;
  readiness_status: string | null;
  blockers: P5ScrBlocker[];
}

export async function p5scrFetchSubjectStatus(
  subjectId: string,
): Promise<P5ScrSubjectStatus> {
  const { data, error } = await (supabase.rpc as any)("p5scr_api_subject_status", {
    p_subject_id: subjectId,
  });
  if (error) throw error;
  return data as P5ScrSubjectStatus;
}

export async function p5scrFetchGateReadiness(
  subjectId: string,
  gate: string,
): Promise<P5ScrGateReadiness> {
  const { data, error } = await (supabase.rpc as any)("p5scr_api_gate_readiness", {
    p_subject_id: subjectId,
    p_gate: gate,
  });
  if (error) throw error;
  return data as P5ScrGateReadiness;
}
