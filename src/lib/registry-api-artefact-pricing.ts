/**
 * P-4 Point 4 — Token / Credit Burn per Chargeable API Call (browser SSOT).
 *
 * Client-confirmed rule (David):
 *   Production API calls burn credits only when they create, return,
 *   update or confirm a governed commercial artefact.
 *
 *   Base unit: 1 Basic POI = USD $10 = 1 base credit unit.
 *
 *   Pricing reference: Izenzo USD Artefact Price Book (2026-06).
 *
 * Smallest-unit model
 * -------------------
 * The wallet operates on whole `credits` today. To carry the price-book's
 * fractional credit costs (e.g. $25 = 2.5 credits) without unsafe rounding,
 * this SSOT models pricing in CREDIT UNITS where:
 *
 *     1 credit       = 100 credit_units
 *     USD $10        = 100 credit_units = 1 credit
 *     USD $0.10      = 1 credit_unit
 *
 * The burn planner returns BOTH:
 *   - exact credit_units (lossless),
 *   - and the integer wallet `credits` value that may be passed to
 *     `atomic_token_burn`.
 *
 * When credit_units are NOT divisible by 100, the wallet does not support
 * the exact charge today; the planner fails CLOSED with
 * `FRACTIONAL_BURN_REQUIRES_SMALLEST_UNIT_MIGRATION` so we never silently
 * round client money.
 *
 * Mirror: supabase/functions/_shared/registry-api-artefact-pricing.ts
 * Parity: scripts/check-registry-api-artefact-pricing-parity.mjs
 */

export const CREDIT_UNITS_PER_CREDIT = 100;
export const USD_PER_CREDIT = 10;
export const USD_PER_CREDIT_UNIT = 0.1;

export const ARTEFACT_CATEGORIES = [
  "trading_spine",
  "counterparty",
  "poi",
  "wad",
  "governance_compliance",
  "bankability",
  "execution",
  "entry_exit",
  "finality",
  "memory",
] as const;
export type ArtefactCategory = (typeof ARTEFACT_CATEGORIES)[number];

export interface ArtefactPrice {
  code: string;
  label: string;
  category: ArtefactCategory;
  /** Lower-bound USD price from the price book. */
  usd_price: number;
  /** Optional upper-bound for variable-range artefacts. */
  usd_price_upper?: number;
  /** Price-book carries a range (e.g. $75–$150). */
  variable: boolean;
  active: boolean;
  chargeable: boolean;
  notes?: string;
}

/**
 * Canonical artefact price book. Lower-bound used as the default price for
 * variable artefacts (Option A in the spec). Variant codes may be added in a
 * later batch (Option B); admin-specified burn is Option C.
 */
export const ARTEFACT_PRICE_BOOK: readonly ArtefactPrice[] = [
  // 1. Trading Spine
  { code: "basic_poi_record", label: "Basic POI Record", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "buyer_poi", label: "Buyer POI", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "seller_poi", label: "Seller POI", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "offer_record", label: "Offer Record", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "demand_record", label: "Demand Record", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "trade_interest_record", label: "Trade Interest Record", category: "trading_spine", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "buyer_match", label: "Buyer Match", category: "trading_spine", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "seller_match", label: "Seller Match", category: "trading_spine", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "trade_match", label: "Trade Match", category: "trading_spine", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "price_record", label: "Price Record", category: "trading_spine", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "volume_record", label: "Volume Record", category: "trading_spine", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "route_record", label: "Route Record", category: "trading_spine", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "product_specification", label: "Product Specification", category: "trading_spine", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "trade_terms", label: "Trade Terms", category: "trading_spine", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "trade_flow", label: "Trade Flow", category: "trading_spine", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "trade_flow_pack", label: "Trade Flow Pack", category: "trading_spine", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "commodity_execution_pack", label: "Commodity Execution Pack", category: "trading_spine", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },

  // 2. Counterparty
  { code: "basic_counterparty", label: "Basic Counterparty", category: "counterparty", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "counterparty_profile", label: "Counterparty Profile", category: "counterparty", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "registry_record", label: "Registry Record", category: "counterparty", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "claimed_company", label: "Claimed Company", category: "counterparty", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "verified_actor", label: "Verified Actor", category: "counterparty", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "director_officer", label: "Director / Officer", category: "counterparty", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "ubo", label: "UBO", category: "counterparty", usd_price: 75, variable: false, active: true, chargeable: true },
  { code: "authority", label: "Authority", category: "counterparty", usd_price: 75, variable: false, active: true, chargeable: true },
  { code: "mandate", label: "Mandate", category: "counterparty", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "verified_counterparty", label: "Verified Counterparty", category: "counterparty", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "counterparty_risk", label: "Counterparty Risk", category: "counterparty", usd_price: 150, variable: false, active: true, chargeable: true },
  { code: "verified_counterparty_pack", label: "Verified Counterparty Pack", category: "counterparty", usd_price: 500, usd_price_upper: 2500, variable: true, active: true, chargeable: true },
  { code: "institutional_counterparty_pack", label: "Institutional Counterparty Pack", category: "counterparty", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },

  // 3. POI
  { code: "basic_poi", label: "Basic POI", category: "poi", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "draft_poi", label: "Draft POI", category: "poi", usd_price: 10, variable: false, active: true, chargeable: true },
  { code: "accepted_poi", label: "Accepted POI", category: "poi", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "mutual_intent_record", label: "Mutual Intent Record", category: "poi", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "authority_backed_poi", label: "Authority-backed POI", category: "poi", usd_price: 75, usd_price_upper: 150, variable: true, active: true, chargeable: true },
  { code: "bankable_poi", label: "Bankable POI", category: "poi", usd_price: 100, usd_price_upper: 250, variable: true, active: true, chargeable: true },
  { code: "institutional_poi_pack", label: "Institutional POI Pack", category: "poi", usd_price: 250, usd_price_upper: 500, variable: true, active: true, chargeable: true },

  // 4. WaD
  { code: "basic_wad", label: "Basic WaD", category: "wad", usd_price: 75, variable: false, active: true, chargeable: true },
  { code: "counterparty_wad", label: "Counterparty WaD", category: "wad", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "mandate_wad", label: "Mandate WaD", category: "wad", usd_price: 150, variable: false, active: true, chargeable: true },
  { code: "institutional_wad", label: "Institutional WaD", category: "wad", usd_price: 200, variable: false, active: true, chargeable: true },
  { code: "transaction_wad", label: "Transaction WaD", category: "wad", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "project_wad", label: "Project WaD", category: "wad", usd_price: 350, variable: false, active: true, chargeable: true },
  { code: "infrastructure_wad", label: "Infrastructure WaD", category: "wad", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "wad_refresh_update", label: "WaD Refresh / Update", category: "wad", usd_price: 50, usd_price_upper: 150, variable: true, active: true, chargeable: true },
  { code: "wad_evidence_pack", label: "WaD Evidence Pack", category: "wad", usd_price: 500, usd_price_upper: 2500, variable: true, active: true, chargeable: true },
  { code: "institutional_wad_pack", label: "Institutional WaD Pack", category: "wad", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "infrastructure_wad_pack", label: "Infrastructure WaD Pack", category: "wad", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },

  // 5. Governance & Compliance
  { code: "kyc_kyb", label: "KYC / KYB", category: "governance_compliance", usd_price: 50, usd_price_upper: 150, variable: true, active: true, chargeable: true },
  { code: "compliance", label: "Compliance", category: "governance_compliance", usd_price: 250, usd_price_upper: 500, variable: true, active: true, chargeable: true },
  { code: "verification", label: "Verification", category: "governance_compliance", usd_price: 50, usd_price_upper: 150, variable: true, active: true, chargeable: true },
  { code: "risk_check", label: "Risk Check", category: "governance_compliance", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "permission", label: "Permission", category: "governance_compliance", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "access", label: "Access", category: "governance_compliance", usd_price: 50, variable: false, active: true, chargeable: true },
  { code: "exception", label: "Exception", category: "governance_compliance", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "decision", label: "Decision", category: "governance_compliance", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "approval", label: "Approval", category: "governance_compliance", usd_price: 150, variable: false, active: true, chargeable: true },
  { code: "approval_trail", label: "Approval Trail", category: "governance_compliance", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "audit_trail", label: "Audit Trail", category: "governance_compliance", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "hash_chain_record", label: "Hash-chain / Tamper-evident Record", category: "governance_compliance", usd_price: 0, variable: false, active: true, chargeable: false, notes: "Included in governance layer" },
  { code: "governance_pack", label: "Governance Pack", category: "governance_compliance", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "compliance_evidence_pack", label: "Compliance Evidence Pack", category: "governance_compliance", usd_price: 5000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },
  { code: "institutional_governance_pack", label: "Institutional Governance Pack", category: "governance_compliance", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },

  // 6. Bankability
  { code: "bankability_profile", label: "Bankability Profile", category: "bankability", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "bank_detail_confidence_record", label: "Bank-detail Confidence Record", category: "bankability", usd_price: 75, variable: false, active: true, chargeable: true },
  { code: "funder_readiness", label: "Funder-readiness", category: "bankability", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "eligibility", label: "Eligibility", category: "bankability", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "funding_readiness", label: "Funding Readiness", category: "bankability", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "commercial_model", label: "Commercial Model", category: "bankability", usd_price: 1000, usd_price_upper: 5000, variable: true, active: true, chargeable: true },
  { code: "risk_pack", label: "Risk Pack", category: "bankability", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "compliance_pack", label: "Compliance Pack", category: "bankability", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "dd_pack", label: "DD Pack", category: "bankability", usd_price: 5000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },
  { code: "bankability_pack", label: "Bankability Pack", category: "bankability", usd_price: 2500, usd_price_upper: 25000, variable: true, active: true, chargeable: true },
  { code: "institutional_bankability_pack", label: "Institutional Bankability Pack", category: "bankability", usd_price: 25000, usd_price_upper: 100000, variable: true, active: true, chargeable: true },

  // 7. Execution
  { code: "execution_action", label: "Action", category: "execution", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "execution_response", label: "Response", category: "execution", usd_price: 25, variable: false, active: true, chargeable: true },
  { code: "milestone", label: "Milestone", category: "execution", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "obligation", label: "Obligation", category: "execution", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "execution_state", label: "Execution State", category: "execution", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "delivery", label: "Delivery", category: "execution", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "evidence_artefact", label: "Evidence Artefact", category: "execution", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "completion", label: "Completion", category: "execution", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "execution_exception", label: "Execution Exception", category: "execution", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "execution_ledger_pack", label: "Execution Ledger Pack", category: "execution", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "institutional_execution_pack", label: "Institutional Execution Pack", category: "execution", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },

  // 8. Entry / Exit
  { code: "entry", label: "Entry", category: "entry_exit", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "access_approval", label: "Access Approval", category: "entry_exit", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "market_entry", label: "Market Entry", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "corridor_entry", label: "Corridor Entry", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "onboarding", label: "Onboarding", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "rejection", label: "Rejection", category: "entry_exit", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "suspension", label: "Suspension", category: "entry_exit", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "exit", label: "Exit", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "removal", label: "Removal", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "exit_rationale", label: "Exit Rationale", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "re_entry", label: "Re-entry", category: "entry_exit", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "entry_exit_pack", label: "Entry / Exit Pack", category: "entry_exit", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "institutional_onboarding_pack", label: "Institutional Onboarding Pack", category: "entry_exit", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },

  // 9. Finality
  { code: "basic_finality", label: "Basic Finality", category: "finality", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "delivery_finality", label: "Delivery Finality", category: "finality", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "payment_evidence", label: "Payment Evidence", category: "finality", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "obligation_finality", label: "Obligation Finality", category: "finality", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "settlement_artefact", label: "Settlement Artefact", category: "finality", usd_price: 500, usd_price_upper: 2500, variable: true, active: true, chargeable: true },
  { code: "institutional_finality", label: "Institutional Finality", category: "finality", usd_price: 2500, usd_price_upper: 10000, variable: true, active: true, chargeable: true },
  { code: "exception_finality", label: "Exception Finality", category: "finality", usd_price: 1000, usd_price_upper: 5000, variable: true, active: true, chargeable: true },
  { code: "trade_finality_pack", label: "Trade Finality Pack", category: "finality", usd_price: 5000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },
  { code: "project_finality_pack", label: "Project Finality Pack", category: "finality", usd_price: 10000, usd_price_upper: 25000, variable: true, active: true, chargeable: true },
  { code: "infrastructure_finality_pack", label: "Infrastructure Finality Pack", category: "finality", usd_price: 25000, usd_price_upper: 100000, variable: true, active: true, chargeable: true },

  // 10. Memory
  { code: "prior_evidence", label: "Prior Evidence", category: "memory", usd_price: 100, variable: false, active: true, chargeable: true },
  { code: "pattern", label: "Pattern", category: "memory", usd_price: 250, variable: false, active: true, chargeable: true },
  { code: "performance", label: "Performance", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "counterparty_memory", label: "Counterparty Memory", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "transaction_memory", label: "Transaction Memory", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "risk_memory", label: "Risk Memory", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "governance_memory", label: "Governance Memory", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "trade_memory", label: "Trade Memory", category: "memory", usd_price: 500, variable: false, active: true, chargeable: true },
  { code: "institutional_memory", label: "Institutional Memory", category: "memory", usd_price: 1000, usd_price_upper: 5000, variable: true, active: true, chargeable: true },
  { code: "institutional_memory_pack", label: "Institutional Memory Pack", category: "memory", usd_price: 25000, usd_price_upper: 100000, variable: true, active: true, chargeable: true },
  { code: "corridor_memory_pack", label: "Corridor Memory Pack", category: "memory", usd_price: 25000, usd_price_upper: 100000, variable: true, active: true, chargeable: true },
] as const;

export type ArtefactCode = (typeof ARTEFACT_PRICE_BOOK)[number]["code"];

/** Endpoint categories that NEVER burn credits. */
export const NON_CHARGEABLE_REASONS = [
  "authentication",
  "health_check",
  "documentation",
  "balance_check",
  "sandbox",
  "failed_technical_call",
  "unauthorised",
  "revoked_key",
  "invalid_scope",
  "malformed_request",
  "no_result_no_artefact",
] as const;
export type NonChargeableReason = (typeof NON_CHARGEABLE_REASONS)[number];

/** Audit event names emitted by the artefact burn wrapper. */
export const ARTEFACT_BURN_AUDIT_EVENTS = [
  "api.token_burn.succeeded",
  "api.token_burn.insufficient_credits",
  "api.token_burn.skipped_sandbox",
  "api.token_burn.skipped_non_chargeable",
  "api.token_burn.skipped_no_result",
  "api.token_burn.skipped_failed_call",
  "api.token_burn.idempotent_replay",
  "api.token_burn.reversed",
  "api.token_burn.missing_price_fail_closed",
  "api.token_burn.variable_price_unresolved",
] as const;
export type ArtefactBurnAuditEvent = (typeof ARTEFACT_BURN_AUDIT_EVENTS)[number];

/** Convert USD → credit_units (lossless). USD $0.10 = 1 credit_unit. */
export function usdToCreditUnits(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("usdToCreditUnits: usd must be a non-negative finite number");
  }
  // 1 USD = 10 credit_units. Multiply then round to nearest integer
  // (USD prices in the book are whole dollars, so this is exact).
  return Math.round(usd * 10);
}

/** Convert credit_units → wallet `credits` (decimal display value). */
export function creditUnitsToCredits(units: number): number {
  return units / CREDIT_UNITS_PER_CREDIT;
}

/** Lookup an artefact price by code. */
export function getArtefactPrice(code: string): ArtefactPrice | undefined {
  return ARTEFACT_PRICE_BOOK.find((p) => p.code === code);
}

export interface BurnPlanInput {
  environment: "production" | "sandbox";
  artefact_code: string;
  /** True iff the API call actually created/returned/updated/confirmed the artefact. */
  artefact_was_produced: boolean;
  /** Non-chargeable category, if applicable (auth, health, etc.). */
  non_chargeable_reason?: NonChargeableReason;
  /**
   * Admin-resolved exact USD price for variable-range artefacts (Option C).
   * MUST be within [usd_price, usd_price_upper]. Ignored for fixed prices.
   */
  admin_resolved_usd_price?: number;
}

export type BurnPlan =
  | {
      action: "skip";
      reason: NonChargeableReason | "demo" | "non_production";
      audit_event: ArtefactBurnAuditEvent;
    }
  | {
      action: "burn";
      artefact_code: string;
      usd_price: number;
      credit_units: number;
      /** Integer wallet credits to deduct via `atomic_token_burn`. */
      wallet_credits: number;
      /** True iff credit_units divides evenly into the integer wallet. */
      smallest_unit_exact: boolean;
      audit_event: ArtefactBurnAuditEvent;
    }
  | {
      action: "fail_closed";
      reason:
        | "missing_price"
        | "inactive_artefact"
        | "non_chargeable_artefact"
        | "variable_price_unresolved"
        | "variable_price_out_of_range"
        | "fractional_burn_requires_smallest_unit_migration"
        | "client_set_price_forbidden";
      artefact_code: string;
      audit_event: ArtefactBurnAuditEvent;
    };

/**
 * Pure planner — decides what (if anything) to burn for a single API call.
 * MUST be called server-side BEFORE doing paid work.
 */
export function planArtefactBurn(input: BurnPlanInput): BurnPlan {
  // Non-chargeable reasons short-circuit FIRST.
  if (input.non_chargeable_reason) {
    const r = input.non_chargeable_reason;
    const audit_event: ArtefactBurnAuditEvent =
      r === "sandbox"
        ? "api.token_burn.skipped_sandbox"
        : r === "failed_technical_call"
          ? "api.token_burn.skipped_failed_call"
          : r === "no_result_no_artefact"
            ? "api.token_burn.skipped_no_result"
            : "api.token_burn.skipped_non_chargeable";
    return { action: "skip", reason: r, audit_event };
  }

  if (input.environment !== "production") {
    return {
      action: "skip",
      reason: "non_production",
      audit_event: "api.token_burn.skipped_sandbox",
    };
  }

  if (!input.artefact_was_produced) {
    return {
      action: "skip",
      reason: "no_result_no_artefact",
      audit_event: "api.token_burn.skipped_no_result",
    };
  }

  const price = getArtefactPrice(input.artefact_code);
  if (!price) {
    return {
      action: "fail_closed",
      reason: "missing_price",
      artefact_code: input.artefact_code,
      audit_event: "api.token_burn.missing_price_fail_closed",
    };
  }
  if (!price.active) {
    return {
      action: "fail_closed",
      reason: "inactive_artefact",
      artefact_code: input.artefact_code,
      audit_event: "api.token_burn.missing_price_fail_closed",
    };
  }
  if (!price.chargeable) {
    return {
      action: "fail_closed",
      reason: "non_chargeable_artefact",
      artefact_code: input.artefact_code,
      audit_event: "api.token_burn.skipped_non_chargeable",
    };
  }

  // Resolve USD price for the burn.
  let usd_price: number;
  if (price.variable) {
    if (typeof input.admin_resolved_usd_price !== "number") {
      return {
        action: "fail_closed",
        reason: "variable_price_unresolved",
        artefact_code: input.artefact_code,
        audit_event: "api.token_burn.variable_price_unresolved",
      };
    }
    const lo = price.usd_price;
    const hi = price.usd_price_upper ?? price.usd_price;
    if (
      input.admin_resolved_usd_price < lo ||
      input.admin_resolved_usd_price > hi
    ) {
      return {
        action: "fail_closed",
        reason: "variable_price_out_of_range",
        artefact_code: input.artefact_code,
        audit_event: "api.token_burn.variable_price_unresolved",
      };
    }
    usd_price = input.admin_resolved_usd_price;
  } else {
    // Fixed price — admin override forbidden on the chargeable path.
    if (typeof input.admin_resolved_usd_price === "number") {
      return {
        action: "fail_closed",
        reason: "client_set_price_forbidden",
        artefact_code: input.artefact_code,
        audit_event: "api.token_burn.missing_price_fail_closed",
      };
    }
    usd_price = price.usd_price;
  }

  const credit_units = usdToCreditUnits(usd_price);
  const smallest_unit_exact = credit_units % CREDIT_UNITS_PER_CREDIT === 0;
  if (!smallest_unit_exact) {
    // The wallet today only supports whole credits. Fail closed instead of
    // silently rounding — the smallest-unit migration is the explicit fix.
    return {
      action: "fail_closed",
      reason: "fractional_burn_requires_smallest_unit_migration",
      artefact_code: input.artefact_code,
      audit_event: "api.token_burn.missing_price_fail_closed",
    };
  }
  const wallet_credits = credit_units / CREDIT_UNITS_PER_CREDIT;

  return {
    action: "burn",
    artefact_code: input.artefact_code,
    usd_price,
    credit_units,
    wallet_credits,
    smallest_unit_exact,
    audit_event: "api.token_burn.succeeded",
  };
}

/**
 * Hard-coded sanity invariants — checked by the parity guard so the price
 * book cannot drift from David's confirmation without a deliberate change.
 */
export const ARTEFACT_PRICING_INVARIANTS = {
  base_unit_usd: 10,
  base_unit_credits: 1,
  base_unit_credit_units: 100,
  basic_poi_usd: 10,
  basic_poi_credits: 1,
  counterparty_profile_usd: 25,
  counterparty_profile_credit_units: 250,
  verified_counterparty_usd: 100,
  verified_counterparty_credits: 10,
  basic_wad_usd: 75,
  basic_wad_credit_units: 750,
  payment_evidence_usd: 500,
  payment_evidence_credits: 50,
  counterparty_memory_usd: 500,
  counterparty_memory_credits: 50,
} as const;
