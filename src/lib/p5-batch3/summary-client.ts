/**
 * P-5 Batch 3 — Stage 5 funder summary client.
 *
 * Thin wrapper over supabase.functions.invoke('p5-batch3-funder-summary').
 *
 * Funder UI MUST NOT read directly from p5_batch3_* tables, MUST NOT call
 * admin RPCs, and MUST NOT construct a public /api/v1/funder/* URL. This
 * client is the single funder read path.
 *
 * The edge function:
 *   - validates the caller's JWT;
 *   - enforces active, non-expired, non-revoked access grant via RLS;
 *   - returns only fields on P5B3_FUNDER_ALLOWED_RELEASED_FIELDS;
 *   - masks bank fields by default;
 *   - downgrades unsafe provider wording to safe labels.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  P5B3_FUNDER_ALLOWED_RELEASED_FIELDS,
  isFieldVisibleToFunder,
} from "./visibility";
import {
  isLabelSafe,
  isLabelUnsafe,
  type P5B3WordingContext,
} from "./provider-wording";
import type { P5B3FunderStatus, P5B3RequestStatus } from "./constants";

export const P5B3_FUNDER_SUMMARY_FN = "p5-batch3-funder-summary";

export interface P5B3FunderSummaryRequest {
  /** Transaction reference scoping the safe summary. */
  transaction_reference: string;
}

export interface P5B3FunderAccessGrantSummary {
  id: string;
  funder_organisation_id: string;
  funder_user_id: string;
  transaction_reference: string;
  evidence_pack_version: string;
  expiry_at: string;
  status: "active" | "revoked" | "expired";
  funder_status: P5B3FunderStatus | null;
  can_download: boolean;
}

export interface P5B3FunderSummaryResponse {
  /** Safe, allow-listed fields only. Bank fields are masked at the server. */
  transaction_summary?: string;
  released_evidence_pack_version?: string;
  released_pack_sha256?: string;
  outcome_history?: Array<{
    outcome_type: string;
    submitted_at: string;
    status?: string;
  }>;
  request_thread_public?: Array<{
    id: string;
    category: string;
    status: P5B3RequestStatus;
    submitted_at: string;
    external_message?: string | null;
  }>;
  counterparty_display_name?: string;
  jurisdiction_summary?: string;
  /** Already filtered through provider wording allow-list at the server. */
  provider_safe_status_label?: string;
  /** Echoed back so the UI can show expiry and status without re-reading the table. */
  access_grant?: P5B3FunderAccessGrantSummary;
}

export interface P5B3FunderSummaryDenied {
  error: string;
  reason?:
    | "auth_required"
    | "no_active_grant"
    | "grant_expired"
    | "grant_revoked"
    | "transaction_reference_required";
}

export type P5B3FunderSummaryResult =
  | { ok: true; data: P5B3FunderSummaryResponse }
  | { ok: false; denial: P5B3FunderSummaryDenied };

/**
 * Defensive client-side allow-list pass. The server already filters, but
 * if a future server bug ever leaks a field, this strips it before render.
 */
export function stripUnsafeFields(
  raw: Record<string, unknown>,
): Partial<P5B3FunderSummaryResponse> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (k === "access_grant") {
      out[k] = raw[k]; // grant envelope is its own safe shape
      continue;
    }
    if (isFieldVisibleToFunder(k)) out[k] = raw[k];
  }
  return out as Partial<P5B3FunderSummaryResponse>;
}

/**
 * Defensive wording guard. The server downgrades unsafe labels, but the
 * UI re-checks and downgrades again as a belt-and-braces measure.
 */
export function guardProviderWording(
  label: string | null | undefined,
  ctx: P5B3WordingContext,
): string {
  if (!label) return "Provider result unavailable";
  if (isLabelSafe(label)) return label;
  if (isLabelUnsafe(label)) {
    if (ctx.provider_live && ctx.provider_result_reference) return label;
    if (ctx.approved_manual_decision_ref) return label;
    return "External Provider Result Pending";
  }
  return "External Provider Result Pending";
}

export async function fetchFunderSummary(
  req: P5B3FunderSummaryRequest,
): Promise<P5B3FunderSummaryResult> {
  const client = supabase as unknown as {
    functions: {
      invoke: (
        name: string,
        opts: { body: unknown },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  const { data, error } = await client.functions.invoke(P5B3_FUNDER_SUMMARY_FN, {
    body: { transaction_reference: req.transaction_reference },
  });
  if (error) {
    return { ok: false, denial: { error: error.message } };
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  if (typeof raw.error === "string") {
    return {
      ok: false,
      denial: {
        error: raw.error as string,
        reason: (raw.reason as P5B3FunderSummaryDenied["reason"]) ?? undefined,
      },
    };
  }
  const safe = stripUnsafeFields(raw) as P5B3FunderSummaryResponse;
  return { ok: true, data: safe };
}

/** Re-export for callers that want to advertise the allow-list. */
export { P5B3_FUNDER_ALLOWED_RELEASED_FIELDS };
