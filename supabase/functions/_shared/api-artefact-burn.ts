/**
 * P-4 Point 4 — Shared API artefact burn wrapper.
 *
 * Wraps the existing `atomic_token_burn` engine with the artefact-pricing
 * planner. Every chargeable institutional-API path MUST call
 * `burnArtefactForApiCall` instead of calling `atomic_token_burn` directly.
 *
 * Non-chargeable paths (auth/health/docs/balance/sandbox) MUST NOT call this
 * helper — the non-chargeable guard enforces that.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  planArtefactBurn,
  type BurnPlan,
  type BurnPlanInput,
  ARTEFACT_BURN_AUDIT_EVENTS,
} from "./registry-api-artefact-pricing.ts";

export interface BurnContext extends BurnPlanInput {
  org_id: string;
  api_client_id: string | null;
  api_key_id: string | null;
  endpoint: string;
  request_id: string;
}

export interface BurnExecResult {
  ok: boolean;
  status: "burned" | "skipped" | "blocked_insufficient_credits" | "fail_closed" | "idempotent_replay";
  plan: BurnPlan;
  credits_burned?: number;
  remaining_balance?: number;
  required_credits?: number;
  available_credits?: number;
  audit_event: string;
  /** HTTP status the caller should return; 0 = caller decides. */
  http_status: number;
  /** Safe error code for client-facing 402 / configuration responses. */
  error_code?: string;
  /** Safe message for client-facing responses. */
  error_message?: string;
}

const SAFE_INSUFFICIENT_CODE = "INSUFFICIENT_CREDITS";
const SAFE_INSUFFICIENT_MSG = "Insufficient credits for this API call.";
const SAFE_CONFIG_CODE = "PRICING_CONFIG_ERROR";
const SAFE_CONFIG_MSG = "Pricing for this artefact is not configured.";
const SAFE_VARIABLE_CODE = "VARIABLE_PRICE_UNRESOLVED";
const SAFE_VARIABLE_MSG = "Variable-price artefact requires an admin-resolved price before execution.";

/**
 * Execute the burn for an institutional-API call.
 * IMPORTANT: callers MUST resolve `artefact_was_produced` *before* invoking
 * this for production-paid work. The planner short-circuits to a skip when
 * no artefact is produced.
 */
export async function burnArtefactForApiCall(
  supabase: SupabaseClient,
  ctx: BurnContext,
): Promise<BurnExecResult> {
  const plan = planArtefactBurn(ctx);

  if (plan.action === "skip") {
    return {
      ok: true,
      status: "skipped",
      plan,
      audit_event: plan.audit_event,
      http_status: 0,
    };
  }

  if (plan.action === "fail_closed") {
    const isVariable = plan.reason === "variable_price_unresolved" || plan.reason === "variable_price_out_of_range";
    return {
      ok: false,
      status: "fail_closed",
      plan,
      audit_event: plan.audit_event,
      http_status: isVariable ? 409 : 500,
      error_code: isVariable ? SAFE_VARIABLE_CODE : SAFE_CONFIG_CODE,
      error_message: isVariable ? SAFE_VARIABLE_MSG : SAFE_CONFIG_MSG,
    };
  }

  // Idempotency: rely on request_id as the burn reference; the underlying
  // `atomic_token_burn` already de-duplicates on (org_id, reference_id) when
  // wired with `p_reference_id = request_id`.
  const { data, error } = await supabase.rpc("atomic_token_burn", {
    p_org_id: ctx.org_id,
    p_amount: plan.wallet_credits,
    p_reason: `api_artefact:${plan.artefact_code}`,
    p_reference_id: ctx.request_id,
    p_governance: {
      event_type: "credit.burned",
      aggregate_type: "credit_burn",
      aggregate_id: ctx.org_id,
      actor_role: ctx.api_key_id ? "api_key" : "system",
      system_actor: "api-artefact-burn",
      source_function: "burnArtefactForApiCall",
      request_id: ctx.request_id,
      correlation_id: ctx.request_id,
      idempotency_key: `api.artefact_burn:${ctx.org_id}:${ctx.request_id}`,
      allowed_or_blocked: "allowed",
      reason_code: `api_artefact:${plan.artefact_code}`,
      metadata: {
        endpoint: ctx.endpoint,
        artefact_code: plan.artefact_code,
        usd_price: plan.usd_price,
        credit_units: plan.credit_units,
        wallet_credits: plan.wallet_credits,
        environment: ctx.environment,
        api_client_id: ctx.api_client_id,
        api_key_id: ctx.api_key_id,
        category: "institutional_api_artefact_burn",
      },
    },
  });

  if (error) {
    return {
      ok: false,
      status: "fail_closed",
      plan,
      audit_event: "api.token_burn.missing_price_fail_closed",
      http_status: 500,
      error_code: SAFE_CONFIG_CODE,
      error_message: SAFE_CONFIG_MSG,
    };
  }

  if (!data?.success) {
    return {
      ok: false,
      status: "blocked_insufficient_credits",
      plan,
      required_credits: plan.wallet_credits,
      available_credits: data?.current_balance ?? 0,
      audit_event: "api.token_burn.insufficient_credits",
      http_status: 402,
      error_code: SAFE_INSUFFICIENT_CODE,
      error_message: SAFE_INSUFFICIENT_MSG,
    };
  }

  if (data.idempotent_replay === true) {
    return {
      ok: true,
      status: "idempotent_replay",
      plan,
      credits_burned: 0,
      remaining_balance: data.balance_after,
      audit_event: "api.token_burn.idempotent_replay",
      http_status: 0,
    };
  }

  return {
    ok: true,
    status: "burned",
    plan,
    credits_burned: plan.wallet_credits,
    remaining_balance: data.balance_after,
    audit_event: "api.token_burn.succeeded",
    http_status: 0,
  };
}

/** Build the safe 402 response body required by the spec. */
export function buildInsufficientCreditsBody(result: BurnExecResult, request_id: string) {
  return {
    ok: false,
    error: {
      code: result.error_code ?? SAFE_INSUFFICIENT_CODE,
      message: result.error_message ?? SAFE_INSUFFICIENT_MSG,
      required_credits: result.required_credits ?? 0,
      available_credits: result.available_credits ?? 0,
      request_id,
    },
  };
}

export { ARTEFACT_BURN_AUDIT_EVENTS };
