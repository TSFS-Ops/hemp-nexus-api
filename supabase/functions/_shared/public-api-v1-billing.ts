/**
 * Public API V1 · Batch 7 — Commercial plans & billing visibility helpers.
 *
 * Adds:
 *   • getActivePlanForClient(): resolves the single active plan assignment
 *     and its plan row for an api_client (one active assignment is enforced
 *     by a partial unique index on api_client_plan_assignments).
 *   • planMonthlyAllowance(): returns the production monthly allowance the
 *     gateway should use — the plan's included_lookup_allowance when an
 *     active plan exists, otherwise the Batch-6 default (5,000).
 *   • computeBillingVisibility(): pure billing-visibility derivation from
 *     api_request_logs for a given api_client + billing period. Returns
 *     included_used / overage_lookups / estimated_overage_amount /
 *     estimated_total_amount. NO invoice number, NO tax computation, NO
 *     payment status, NO payment-method exposure.
 *   • Audit helpers for plan lifecycle / assignment events.
 *
 * Hard exclusions (Batch 7): no payment collection, no PayFast/Paystack
 * changes, no invoice rows, no tax invoice logic, no card/bank/payment-
 * method fields, no /v1/usage/current endpoint, no client usage dashboard,
 * no internal monitoring dashboard, no docs/OpenAPI, no support intake, no
 * webhook changes, no write API, no evidence/document exposure, no POI /
 * WaD / payment / credit / compliance / verification decisions. Billing
 * visibility is DERIVED from api_request_logs — no separate billing ledger.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { V1_COUNTABLE_ENDPOINTS, V1_DEFAULT_MONTHLY_PROD, currentPeriodStart } from "./public-api-v1-usage.ts";

export interface CommercialPlan {
  id: string;
  plan_name: string;
  description: string | null;
  currency: string;
  monthly_fee: number;
  included_lookup_allowance: number;
  overage_price_per_successful_lookup: number;
  manual_review_fee: number;
  billing_cycle: string;
  overage_allowed: boolean;
  active: boolean;
}

export interface ActivePlanAssignment {
  id: string;
  api_client_id: string;
  api_commercial_plan_id: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  assigned_by: string;
  assigned_at: string;
}

export interface ResolvedPlan {
  plan: CommercialPlan;
  assignment: ActivePlanAssignment;
}

/** Resolves the single active plan + assignment for an api_client (or null). */
export async function getActivePlanForClient(
  supabase: SupabaseClient,
  apiClientId: string,
): Promise<ResolvedPlan | null> {
  const { data: assignment, error } = await supabase
    .from("api_client_plan_assignments")
    .select("id, api_client_id, api_commercial_plan_id, starts_at, ends_at, active, assigned_by, assigned_at")
    .eq("api_client_id", apiClientId)
    .eq("active", true)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !assignment) return null;
  const { data: plan } = await supabase
    .from("api_commercial_plans")
    .select("*")
    .eq("id", (assignment as ActivePlanAssignment).api_commercial_plan_id)
    .maybeSingle();
  if (!plan) return null;
  const p = plan as CommercialPlan;
  if (!p.active) return null; // deactivated plan: fall back to defaults
  return { plan: p, assignment: assignment as ActivePlanAssignment };
}

/**
 * Production monthly allowance the gateway should enforce for this client.
 * Active plan's included_lookup_allowance takes precedence over the
 * Batch-6 default of 5,000. Sandbox keeps its Batch-6 default.
 */
export function planMonthlyAllowance(resolved: ResolvedPlan | null): number {
  if (!resolved) return V1_DEFAULT_MONTHLY_PROD;
  return resolved.plan.included_lookup_allowance;
}

/**
 * Returns true when a request should be blocked past the soft cap. The
 * gateway always enforces a 120%-of-allowance hard block (per Batch 6)
 * UNLESS the active plan explicitly permits overage. Temporary overrides
 * (api_usage_overrides) are evaluated separately in public-api-v1-usage
 * and still take precedence over plan rules.
 */
export function planBlocksAtAllowance(resolved: ResolvedPlan | null, current: number, allowance: number): boolean {
  if (allowance <= 0) return false;
  if (!resolved) {
    // No plan → Batch-6 default rule: hard block at 120% of allowance.
    return current >= Math.ceil(1.2 * allowance);
  }
  if (resolved.plan.overage_allowed) {
    // Plan permits overage → still hard-block at 120% as a circuit breaker.
    return current >= Math.ceil(1.2 * allowance);
  }
  // Plan forbids overage → block strictly at allowance.
  return current >= allowance;
}

// ─── Billing visibility (derived from api_request_logs only) ─────────────

export interface BillingVisibility {
  api_client_id: string;
  plan_id: string | null;
  plan_name: string | null;
  currency: string | null;
  monthly_fee: number;
  included_lookup_allowance: number;
  successful_billable_lookups: number;
  included_used: number;
  overage_lookups: number;
  overage_price_per_successful_lookup: number;
  estimated_overage_amount: number;
  estimated_total_amount: number;
  billing_period_start: string;
  billing_period_end: string;
  overage_allowed: boolean;
  generated_at: string;
}

/**
 * Computes billing visibility from api_request_logs.
 *
 * Billable count includes:
 *   • Successful PRODUCTION /v1/counterparty/lookup calls with billable=true.
 *   • Successful PRODUCTION /v1/counterparty/summary calls with billable=true.
 *
 * Excludes:
 *   • Sandbox calls (environment != 'production').
 *   • Health/status calls (not in V1_COUNTABLE_ENDPOINTS).
 *   • Auth, scope, validation, rate-limit, monthly-block, provider, internal
 *     errors (error_code IS NOT NULL).
 *   • billable=false rows (rejections, validation, sandbox marker scenarios).
 *
 * Estimated overage = max(0, successful_billable_lookups - included_lookup_allowance).
 * Estimated total   = monthly_fee + estimated_overage_amount.
 * (No tax. No invoice number. No payment status.)
 */
export async function computeBillingVisibility(
  supabase: SupabaseClient,
  apiClientId: string,
  periodStart?: Date,
): Promise<BillingVisibility> {
  const start = periodStart ?? currentPeriodStart();
  const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const resolved = await getActivePlanForClient(supabase, apiClientId);

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id")
    .eq("api_client_id", apiClientId);
  const keyIds = (keys ?? []).map((k: { id: string }) => k.id);

  let billable = 0;
  if (keyIds.length > 0) {
    const { count } = await supabase
      .from("api_request_logs")
      .select("id", { count: "exact", head: true })
      .in("api_key_id", keyIds)
      .eq("environment", "production")
      .eq("billable", true)
      .is("error_code", null)
      .in("endpoint", Array.from(V1_COUNTABLE_ENDPOINTS))
      .gte("created_at", start.toISOString())
      .lt("created_at", periodEnd.toISOString());
    billable = count ?? 0;
  }

  const allowance = resolved ? resolved.plan.included_lookup_allowance : 0;
  const includedUsed = Math.min(billable, allowance);
  const overageLookups = Math.max(0, billable - allowance);
  const overagePrice = resolved ? Number(resolved.plan.overage_price_per_successful_lookup) : 0;
  const monthlyFee = resolved ? Number(resolved.plan.monthly_fee) : 0;
  const estimatedOverageAmount = round2(overageLookups * overagePrice);
  const estimatedTotal = round2(monthlyFee + estimatedOverageAmount);

  return {
    api_client_id: apiClientId,
    plan_id: resolved?.plan.id ?? null,
    plan_name: resolved?.plan.plan_name ?? null,
    currency: resolved?.plan.currency ?? null,
    monthly_fee: monthlyFee,
    included_lookup_allowance: allowance,
    successful_billable_lookups: billable,
    included_used: includedUsed,
    overage_lookups: overageLookups,
    overage_price_per_successful_lookup: overagePrice,
    estimated_overage_amount: estimatedOverageAmount,
    estimated_total_amount: estimatedTotal,
    billing_period_start: start.toISOString(),
    billing_period_end: periodEnd.toISOString(),
    overage_allowed: resolved?.plan.overage_allowed ?? false,
    generated_at: new Date().toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
