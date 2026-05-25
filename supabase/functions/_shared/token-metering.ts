import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ApiException } from "./errors.ts";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
  writeGovernanceEventBestEffort,
} from "./governance-audit-integration.ts";
import { CREDIT_POLICY_VERSION } from "./governance-policy-versions.ts";

// Endpoints that are NOT billable (free)
const NON_BILLABLE_ENDPOINTS = [
  '/healthz',
  '/health',
  '/docs',
  '/openapi',
  '/auth',
  '/public-preview',
  '/_shared',
  '/search', // Discovery is free per Work Program
];

// Default minimum token balance (used only if DB value is missing entirely)
const DEFAULT_MINIMUM_TOKEN_BALANCE = 0;

// Tokens consumed per generic API call
const TOKENS_PER_CALL = 1;

// ==============================================
// ACTION-SPECIFIC TOKEN COSTS (from Price List)
// ==============================================
export const ACTION_TOKEN_COSTS = {
  // Transaction lifecycle - single 1-credit charge for POI generation
  'transaction_shell': 1,
  'manual_description': 1,
  'document_upload': 0,
  'counterparty_sighting': 0,  // Collapsed into generate-poi (no separate charge)
  'buyer_commit': 0,           // Collapsed into generate-poi (no separate charge)
  'seller_commit': 0,          // Collapsed into generate-poi (no separate charge)
  'declare_intent': 1,         // This is the single POI credit charge (R10)
  'transaction_complete': 0,   // Free - evidence sealing
  
  // Generic/legacy
  'api_call': 0,
} as const;

export type ActionType = keyof typeof ACTION_TOKEN_COSTS;

// ==============================================
// FINALITY BURN TIERS (from Work Program p.7)
// ==============================================
export function calculateFinalityBurn(transactionValueUsd: number): number {
  if (transactionValueUsd <= 250000) return 50000;
  if (transactionValueUsd <= 1000000) return 75000;
  if (transactionValueUsd <= 5000000) return 100000;
  return 150000;
}

// Low balance warning thresholds
const LOW_BALANCE_THRESHOLDS = [500, 200, 50];

export interface TokenCheckResult {
  allowed: boolean;
  currentBalance: number;
  minimumRequired: number;
  tokensToCharge: number;
  isBillable: boolean;
}

export interface TokenBurnResult {
  success: boolean;
  newBalance: number;
  ledgerEntryId: string;
  /**
   * Phase 1 demo isolation. When the org is flagged `is_demo=true`,
   * burn helpers short-circuit: no `atomic_token_burn` RPC, no token_ledger
   * row, no balance change. The result still returns `success: true` so
   * call-sites continue their workflow, but `skipped` is set to "demo".
   */
  skipped?: "demo";
}

/**
 * Phase 1 demo isolation lookup. Returns true iff `organizations.is_demo`
 * is true for `orgId`. Reads with the provided client (service-role in
 * edge functions). Errors fail closed (treated as NOT demo) so a transient
 * lookup failure can never silently skip a real production burn.
 */
export async function isDemoOrg(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  if (!orgId) return false;
  const { data, error } = await supabase
    .from("organizations")
    .select("is_demo")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[token-metering] is_demo lookup failed; failing closed (not demo):", error);
    return false;
  }
  return (data as { is_demo?: boolean } | null)?.is_demo === true;
}

/**
 * Check if an endpoint is billable
 */
export function isBillableEndpoint(endpoint: string): boolean {
  const normalizedEndpoint = endpoint.toLowerCase();
  
  // Check if endpoint starts with any non-billable prefix
  for (const nonBillable of NON_BILLABLE_ENDPOINTS) {
    if (normalizedEndpoint.startsWith(nonBillable.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if an organisation has sufficient token balance
 */
export async function checkTokenBalance(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string
): Promise<TokenCheckResult> {
  const billable = isBillableEndpoint(endpoint);
  
  if (!billable) {
    return {
      allowed: true,
      currentBalance: 0,
      minimumRequired: 0,
      tokensToCharge: 0,
      isBillable: false,
    };
  }
  
  // Get current token balance
  const { data: balance, error } = await supabase
    .from("token_balances")
    .select("balance, minimum_required")
    .eq("org_id", orgId)
    .maybeSingle();
  
  if (error) {
    console.error("Error checking token balance:", error);
    throw new ApiException(
      "TOKEN_CHECK_FAILED",
      "Failed to check token balance",
      500
    );
  }
  
  // SECURITY: Do not auto-create token balances.
  // Token balances should only be created via the handle_new_user trigger
  // or admin actions. Auto-creation could allow free token exploits.
  if (!balance) {
    console.error("No token balance found for org:", orgId);
    throw new ApiException(
      "TOKEN_NOT_FOUND",
      "Token balance not initialized. Contact support.",
      500
    );
  }
  
  const currentBalance = balance.balance;
  const minimumRequired = balance.minimum_required ?? DEFAULT_MINIMUM_TOKEN_BALANCE;
  
  // Check if balance is sufficient
  const allowed = currentBalance >= minimumRequired;
  
  return {
    allowed,
    currentBalance,
    minimumRequired,
    tokensToCharge: TOKENS_PER_CALL,
    isBillable: true,
  };
}

/**
 * Burn tokens for an API call and record in ledger
 */
export async function burnTokens(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  requestId: string,
  outcome: "allowed" | "blocked",
  metadata?: Record<string, unknown>
): Promise<TokenBurnResult> {
  const billable = isBillableEndpoint(endpoint);
  
  if (!billable) {
    return {
      success: true,
      newBalance: 0,
      ledgerEntryId: "",
    };
  }

  // Phase 1 demo isolation: demo orgs never burn credits or write ledger.
  if (await isDemoOrg(supabase, orgId)) {
    console.log(`[token-metering] demo org ${orgId} → skip burn for ${endpoint}`);
    return {
      success: true,
      newBalance: 0,
      ledgerEntryId: "",
      skipped: "demo",
    };
  }
  
  const tokensToBurn = outcome === "allowed" ? TOKENS_PER_CALL : 0;
  
  let newBalance = 0;
  let previousBalance = 0;
  
  if (tokensToBurn > 0) {
    // Use atomic DB function - single UPDATE ... WHERE balance >= amount
    const { data: burnResult, error: burnError } = await supabase.rpc("atomic_token_burn", {
      p_org_id: orgId,
      p_amount: tokensToBurn,
      p_reason: `api:${endpoint}`,
      p_reference_id: requestId,
    });

    if (burnError) {
      console.error("Error in atomic_token_burn:", burnError);
      // Best-effort attempt audit (do not block the throw)
      await writeGovernanceEventBestEffort(supabase as any, {
        event_type: "credit.burn_attempted",
        org_id: orgId,
        aggregate_type: "credit_burn",
        aggregate_id: orgId,
        actor_user_id: null,
        system_actor: "token-metering",
        source_function: "burnTokens",
        request_id: requestId,
        credit_ledger_id: null,
        allowed_or_blocked: "blocked",
        reason_code: "TOKEN_BURN_RPC_ERROR",
        posture_snapshot: buildPostureSnapshot("Not recorded", {
          policy_version: CREDIT_POLICY_VERSION,
          reason: "atomic_token_burn RPC error before settlement",
        }),
        metadata: { endpoint, error_message: String(burnError.message ?? burnError), policy_version: CREDIT_POLICY_VERSION },
      });
      throw new ApiException("TOKEN_BURN_FAILED", "Failed to burn tokens", 500);
    }

    if (!burnResult?.success) {
      await writeGovernanceEventBestEffort(supabase as any, {
        event_type: "credit.burn_blocked",
        org_id: orgId,
        aggregate_type: "credit_burn",
        aggregate_id: orgId,
        actor_user_id: null,
        system_actor: "token-metering",
        source_function: "burnTokens",
        request_id: requestId,
        allowed_or_blocked: "blocked",
        reason_code: burnResult?.error ?? "INSUFFICIENT_TOKENS",
        posture_snapshot: buildPostureSnapshot("Standard", {
          policy_version: CREDIT_POLICY_VERSION,
          check_status: { current_balance: burnResult?.current_balance ?? 0 },
        }),
        metadata: { endpoint, requested: tokensToBurn, available: burnResult?.current_balance ?? 0, policy_version: CREDIT_POLICY_VERSION },
      });
      throw new ApiException(
        "INSUFFICIENT_TOKEN_BALANCE",
        `Insufficient tokens. Current balance: ${burnResult?.current_balance ?? 0}`,
        402,
        { currentBalance: burnResult?.current_balance ?? 0, requested: tokensToBurn }
      );
    }

    previousBalance = burnResult.balance_before;
    newBalance = burnResult.balance_after;

    // Check if we crossed any low balance thresholds
    await checkAndTriggerLowBalanceWebhooks(supabase, orgId, previousBalance, newBalance);

    // Phase 2 canonical credit.burned event (fail-closed)
    try {
      await writeCriticalEventWithPosture(supabase as any, {
        event_type: "credit.burned",
        org_id: orgId,
        aggregate_type: "credit_burn",
        aggregate_id: orgId,
        actor_user_id: null,
        actor_role: apiKeyId ? "api_key" : "system",
        system_actor: "token-metering",
        source_function: "burnTokens",
        request_id: requestId,
        allowed_or_blocked: "allowed",
        reason_code: `api:${endpoint}`,
        posture: buildPostureSnapshot("Standard", {
          policy_version: CREDIT_POLICY_VERSION,
          check_status: { balance_before: previousBalance, balance_after: newBalance },
        }),
        metadata: {
          endpoint,
          amount: tokensToBurn,
          balance_before: previousBalance,
          balance_after: newBalance,
          api_key_id: apiKeyId,
          policy_version: CREDIT_POLICY_VERSION,
          ...(metadata ?? {}),
        },
        idempotency_extra: requestId,
      });
    } catch (govErr) {
      // Credit burn already debited the ledger; fail-closed means we surface
      // a 500 so the caller does NOT report success for an unaudited burn.
      console.error("CRITICAL: governance audit write failed after burnTokens", govErr);
      throw new ApiException(
        "GOV_AUDIT_WRITE_FAILED",
        "Credit burned but governance audit write failed",
        500,
        { underlying: String((govErr as Error)?.message ?? govErr) }
      );
    }
  } else {
    // Blocked outcome - just get the current balance for the ledger entry
    const { data: currentBalance } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    
    newBalance = currentBalance?.balance || 0;
  }
  
  // Ledger write is now handled inside atomic_token_burn (self-auditing).
  // No duplicate write needed here.
  
  return {
    success: true,
    newBalance,
    ledgerEntryId: "",
  };
}

/**
 * Check if balance crossed low thresholds and trigger webhooks
 */
async function checkAndTriggerLowBalanceWebhooks(
  supabase: SupabaseClient,
  orgId: string,
  previousBalance: number,
  newBalance: number
): Promise<void> {
  for (const threshold of LOW_BALANCE_THRESHOLDS) {
    // Check if we just crossed this threshold
    if (previousBalance > threshold && newBalance <= threshold) {
      console.log(`[Token Metering] Balance crossed ${threshold} threshold for org ${orgId}`);
      
      // Trigger low balance webhook
      try {
        // Fetch active webhook endpoints subscribed to token.low_balance event
        const { data: endpoints, error } = await supabase
          .from("webhook_endpoints")
          .select("*")
          .eq("org_id", orgId)
          .eq("status", "active")
          .contains("events", ["token.low_balance"]);
        
        if (error) {
          console.error("Error fetching webhook endpoints for low balance:", error);
          return;
        }
        
        if (!endpoints || endpoints.length === 0) {
          console.log(`No webhooks registered for token.low_balance event`);
          return;
        }
        
        const payload = {
          event: "token.low_balance",
          data: {
            orgId,
            currentBalance: newBalance,
            threshold,
            minimumRequired: DEFAULT_MINIMUM_TOKEN_BALANCE,
            warning: getWarningMessage(threshold, newBalance),
            urgency: getUrgencyLevel(newBalance),
          },
          timestamp: new Date().toISOString(),
          orgId,
        };
        
        // Deliver webhooks in background
        for (const endpoint of endpoints) {
          deliverLowBalanceWebhook(supabase, endpoint, payload).catch(err =>
            console.error(`Low balance webhook delivery error:`, err)
          );
        }
      } catch (err) {
        console.error("Error triggering low balance webhooks:", err);
      }
      
      // Only trigger once per crossing (don't trigger for multiple thresholds in same call)
      break;
    }
  }
}

function getWarningMessage(threshold: number, balance: number): string {
  if (balance <= 50) {
    return "CRITICAL: Token balance is very low. API calls may fail for actions requiring credits.";
  }
  if (balance <= 200) {
    return "WARNING: Token balance is low. Please top up soon to avoid service interruption.";
  }
  return "NOTICE: Token balance is approaching low levels. Consider topping up.";
}

function getUrgencyLevel(balance: number): "critical" | "warning" | "notice" {
  if (balance <= 50) return "critical";
  if (balance <= 200) return "warning";
  return "notice";
}

async function deliverLowBalanceWebhook(
  supabase: SupabaseClient,
  endpoint: { id: string; url: string; secret_hash: string },
  payload: { event: string; data: Record<string, unknown>; timestamp: string; orgId: string }
): Promise<void> {
  const body = JSON.stringify(payload);
  
  // Generate signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(endpoint.secret_hash);
  const messageData = encoder.encode(body);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signatureHex,
        "X-Webhook-Event": payload.event,
        "X-Webhook-Timestamp": payload.timestamp,
      },
      body,
    });
    
    // Log delivery
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: endpoint.id,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: response.status,
      response_body: (await response.text()).substring(0, 1000),
      delivery_attempt: 1,
    });
    
    console.log(`Low balance webhook delivered to ${endpoint.url}: ${response.status}`);
  } catch (err) {
    console.error(`Failed to deliver low balance webhook to ${endpoint.url}:`, err);
    
    // Log failed delivery
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: endpoint.id,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: 0,
      error_message: err instanceof Error ? err.message : "Unknown error",
      delivery_attempt: 1,
    });
  }
}

/**
 * Middleware function to check and burn tokens
 * Returns true if the request should proceed, throws if blocked
 */
export async function enforceTokenMetering(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  requestId: string
): Promise<void> {
  // Check if endpoint is billable
  if (!isBillableEndpoint(endpoint)) {
    return; // Non-billable endpoints pass through
  }

  // Phase 1 demo isolation: demo orgs bypass metering entirely.
  // No balance check, no burn, no ledger row. Workflow continues.
  if (await isDemoOrg(supabase, orgId)) {
    console.log(`[token-metering] demo org ${orgId} → bypass enforceTokenMetering for ${endpoint}`);
    return;
  }
  
  // Check token balance
  const checkResult = await checkTokenBalance(supabase, orgId, endpoint);
  
  if (!checkResult.allowed) {
    // Record blocked attempt in ledger
    await burnTokens(supabase, orgId, apiKeyId, endpoint, requestId, "blocked", {
      reason: "insufficient_balance",
      required: checkResult.minimumRequired,
      current: checkResult.currentBalance,
    });
    
    throw new ApiException(
      "INSUFFICIENT_TOKEN_BALANCE",
      `Token balance below minimum required threshold (${checkResult.currentBalance}/${checkResult.minimumRequired}). Top up to continue.`,
      402,
      {
        currentBalance: checkResult.currentBalance,
        minimumRequired: checkResult.minimumRequired,
        topUpRequired: checkResult.minimumRequired - checkResult.currentBalance,
      }
    );
  }
  
  // Burn tokens for allowed request
  await burnTokens(supabase, orgId, apiKeyId, endpoint, requestId, "allowed");
}

/**
 * Burn tokens for a specific action with action-type tracking
 * Used for action-specific pricing (counterparty sighting, commits, etc.)
 */
export async function burnTokensForAction(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  actionType: ActionType,
  requestId: string,
  entityId?: string,
  customAmount?: number,
  metadata?: Record<string, unknown>
): Promise<TokenBurnResult> {
  const tokensToBurn = customAmount ?? ACTION_TOKEN_COSTS[actionType];

  // Phase 1 demo isolation: demo orgs short-circuit BEFORE any balance read
  // or RPC. Returns success so the calling workflow can continue, but writes
  // no ledger row and changes no balance.
  if (await isDemoOrg(supabase, orgId)) {
    console.log(`[token-metering] demo org ${orgId} → skip burnTokensForAction(${actionType})`);
    return { success: true, newBalance: 0, ledgerEntryId: "", skipped: "demo" };
  }

  // Skip burn for zero-cost actions
  if (tokensToBurn === 0) {
    const { data: bal } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .maybeSingle();
    return { success: true, newBalance: bal?.balance || 0, ledgerEntryId: "" };
  }

  // Use atomic DB function - single UPDATE ... WHERE balance >= amount
  const { data: burnResult, error: burnError } = await supabase.rpc("atomic_token_burn", {
    p_org_id: orgId,
    p_amount: tokensToBurn,
    p_reason: `action:${actionType}`,
    p_reference_id: requestId,
  });

  if (burnError) {
    console.error("Error in atomic_token_burn for action:", burnError);
    await writeGovernanceEventBestEffort(supabase as any, {
      event_type: "credit.burn_attempted",
      org_id: orgId,
      aggregate_type: "credit_burn",
      aggregate_id: entityId ?? orgId,
      actor_user_id: null,
      system_actor: "token-metering",
      source_function: "burnTokensForAction",
      request_id: requestId,
      allowed_or_blocked: "blocked",
      reason_code: "TOKEN_BURN_RPC_ERROR",
      posture_snapshot: buildPostureSnapshot("Not recorded", {
        reason: "atomic_token_burn RPC error before settlement",
      }),
      metadata: { actionType, error_message: String(burnError.message ?? burnError) },
    });
    throw new ApiException("TOKEN_BURN_FAILED", "Failed to burn tokens", 500);
  }

  if (!burnResult?.success) {
    await writeGovernanceEventBestEffort(supabase as any, {
      event_type: "credit.burn_blocked",
      org_id: orgId,
      aggregate_type: "credit_burn",
      aggregate_id: entityId ?? orgId,
      actor_user_id: null,
      system_actor: "token-metering",
      source_function: "burnTokensForAction",
      request_id: requestId,
      allowed_or_blocked: "blocked",
      reason_code: burnResult?.error ?? "INSUFFICIENT_TOKENS",
      posture_snapshot: buildPostureSnapshot("Standard", {
        check_status: { current_balance: burnResult?.current_balance ?? 0 },
      }),
      metadata: {
        actionType,
        required: tokensToBurn,
        available: burnResult?.current_balance ?? 0,
      },
    });
    throw new ApiException(
      "INSUFFICIENT_TOKEN_BALANCE",
      `Insufficient tokens for ${actionType}. Required: ${tokensToBurn}, Available: ${burnResult?.current_balance ?? 0}`,
      402,
      {
        actionType,
        required: tokensToBurn,
        available: burnResult?.current_balance ?? 0,
      }
    );
  }

  const previousBalance = burnResult.balance_before;
  const newBalance = burnResult.balance_after;

  // Check if we crossed any low balance thresholds
  await checkAndTriggerLowBalanceWebhooks(supabase, orgId, previousBalance, newBalance);

  // Phase 2 canonical credit.burned event (fail-closed)
  try {
    await writeCriticalEventWithPosture(supabase as any, {
      event_type: "credit.burned",
      org_id: orgId,
      aggregate_type: "credit_burn",
      aggregate_id: entityId ?? orgId,
      actor_user_id: null,
      actor_role: apiKeyId ? "api_key" : "system",
      system_actor: "token-metering",
      source_function: "burnTokensForAction",
      request_id: requestId,
      allowed_or_blocked: "allowed",
      reason_code: `action:${actionType}`,
      posture: buildPostureSnapshot("Standard", {
        check_status: { balance_before: previousBalance, balance_after: newBalance },
      }),
      metadata: {
        actionType,
        amount: tokensToBurn,
        balance_before: previousBalance,
        balance_after: newBalance,
        entity_id: entityId ?? null,
        ...(metadata ?? {}),
      },
      idempotency_extra: requestId,
    });
  } catch (govErr) {
    console.error("CRITICAL: governance audit write failed after burnTokensForAction", govErr);
    throw new ApiException(
      "GOV_AUDIT_WRITE_FAILED",
      "Credit burned but governance audit write failed",
      500,
      { underlying: String((govErr as Error)?.message ?? govErr) }
    );
  }

  console.log(`[Token Metering] Burned ${tokensToBurn} tokens for ${actionType} (org: ${orgId})`);

  
  return {
    success: true,
    newBalance,
    ledgerEntryId: "",
  };
}

/**
 * Check if org has sufficient tokens for a specific action
 */
export async function checkSufficientTokensForAction(
  supabase: SupabaseClient,
  orgId: string,
  actionType: ActionType,
  customAmount?: number
): Promise<{ sufficient: boolean; required: number; available: number }> {
  const required = customAmount ?? ACTION_TOKEN_COSTS[actionType];
  
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("org_id", orgId)
    .maybeSingle();
  
  const balanceRow = balance as { balance?: number; minimum_required?: number } | null;
  const currentBalance = balanceRow?.balance || 0;
  const minRequired = balanceRow?.minimum_required ?? DEFAULT_MINIMUM_TOKEN_BALANCE;
  const available = Math.max(0, currentBalance - minRequired);
  
  return {
    sufficient: available >= required,
    required,
    available,
  };
}

/**
 * Ensure sufficient tokens for an action, throw if not
 */
export async function ensureSufficientTokens(
  supabase: SupabaseClient,
  orgId: string,
  requiredTokens: number
): Promise<void> {
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance, minimum_required")
    .eq("org_id", orgId)
    .maybeSingle();
  
  const currentBalance = balance?.balance || 0;
  const minRequired = balance?.minimum_required ?? DEFAULT_MINIMUM_TOKEN_BALANCE;
  const available = Math.max(0, currentBalance - minRequired);
  
  if (available < requiredTokens) {
    throw new ApiException(
      "INSUFFICIENT_TOKEN_BALANCE",
      `Insufficient tokens. Required: ${requiredTokens}, Available: ${available}`,
      402,
      {
        required: requiredTokens,
        available,
        minimumReserve: minRequired,
        topUpRequired: requiredTokens - available,
      }
    );
  }
}

/**
 * Get token usage statistics for an organisation
 */
export async function getTokenUsageStats(
  supabase: SupabaseClient,
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<{
  currentBalance: number;
  minimumRequired: number;
  totalBurnedThisMonth: number;
  callsThisMonth: number;
  blockedCallsThisMonth: number;
  actionBreakdown: Record<string, number>;
}> {
  // Get current balance
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance, minimum_required")
    .eq("org_id", orgId)
    .maybeSingle();
  
  // Calculate date range for this month if not provided
  const now = new Date();
  const monthStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  // Get usage stats from ledger
  const { data: ledgerStats, error } = await supabase
    .from("token_ledger")
    .select("tokens_burned, outcome, action_type")
    .eq("org_id", orgId)
    .gte("created_at", monthStart.toISOString())
    .lte("created_at", monthEnd.toISOString());
  
  if (error) {
    console.error("Error fetching token usage stats:", error);
  }
  
  const stats = ledgerStats || [];
  const totalBurned = stats.reduce((sum, entry) => sum + (entry.tokens_burned || 0), 0);
  const allowedCalls = stats.filter(entry => entry.outcome === "allowed").length;
  const blockedCalls = stats.filter(entry => entry.outcome === "blocked").length;
  
  // Calculate action breakdown
  const actionBreakdown: Record<string, number> = {};
  for (const entry of stats) {
    if (entry.action_type) {
      actionBreakdown[entry.action_type] = (actionBreakdown[entry.action_type] || 0) + (entry.tokens_burned || 0);
    }
  }
  
  return {
    currentBalance: balance?.balance || 0,
    minimumRequired: balance?.minimum_required ?? DEFAULT_MINIMUM_TOKEN_BALANCE,
    totalBurnedThisMonth: totalBurned,
    callsThisMonth: allowedCalls,
    blockedCallsThisMonth: blockedCalls,
    actionBreakdown,
  };
}
